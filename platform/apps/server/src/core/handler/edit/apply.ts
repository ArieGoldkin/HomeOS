import type { EventPatch, SavedEvent } from "../../../db/event-store/index.ts";
import type { InboundMessage } from "../../../http/webhook.ts";
import { pushSavedEventsToCalendar } from "../../../tools/index.ts";
import {
  EDIT_SYNCED_HE,
  familyOf,
  formatWhen,
  type HandlerDeps,
  REPHRASE_HE,
} from "../shared/index.ts";

/**
 * #86 — apply a patch to ONE board row by id: updateEvent re-validates the merge + enforces board-only
 * (G20/G19), then best-effort Calendar patch (reusing the push helper's find(homeosEventId)→patch — no
 * new client method), then "עודכן ✓" built SERVER-side from the updated row (G7). Null update → rephrase.
 */
export async function applyPatchToId(
  deps: HandlerDeps,
  msg: InboundMessage,
  id: number,
  patch: EventPatch,
): Promise<void> {
  const log = deps.log ?? (() => {});
  const family = familyOf(deps);
  const updated = deps.events.updateEvent(id, patch, family);
  if (!updated) {
    await deps.sendText(msg.from, REPHRASE_HE); // synced row / invalid merge → no write happened
    return;
  }
  if (deps.calendar) {
    await pushSavedEventsToCalendar([updated], deps.calendar, family, log); // G25 best-effort
  }
  log("edit applied", { from: msg.from, id: updated.id });
  await deps.sendText(msg.from, `עודכן ✓\n${updated.title_he} · ${formatWhen(updated)}`);
}

/**
 * #161 — apply a held patch to one OR MORE selected board rows (each via updateEvent — board-only, so a
 * synced id can never be written even if it slipped in), best-effort Calendar patch per row, then ONE
 * confirm. A single selection keeps the detailed "עודכן ✓ · title · when"; multi-select sends a summary
 * "עודכנו N פריטים ✓". Zero successful updates → rephrase (e.g. every selected row was synced/invalid).
 */
export async function applyPatchToMany(
  deps: HandlerDeps,
  msg: InboundMessage,
  ids: number[],
  patch: EventPatch,
): Promise<void> {
  if (ids.length === 1) {
    await applyPatchToId(deps, msg, ids[0]!, patch);
    return;
  }
  const log = deps.log ?? (() => {});
  const family = familyOf(deps);
  const updated: SavedEvent[] = [];
  for (const id of ids) {
    const row = deps.events.updateEvent(id, patch, family);
    if (row) {
      updated.push(row);
      if (deps.calendar) {
        await pushSavedEventsToCalendar([row], deps.calendar, family, log); // G25 best-effort
      }
    }
  }
  if (updated.length === 0) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  log("edit multi-select applied", { from: msg.from, count: updated.length });
  await deps.sendText(msg.from, `עודכנו ${updated.length} פריטים ✓`);
}

/** #86 — the explicit 1-match edit: refuse a synced row up front (a read→write loop), else apply. */
export async function applyEdit(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidate: SavedEvent,
  patch: EventPatch,
): Promise<void> {
  if (candidate.source_provider !== null) {
    await deps.sendText(msg.from, EDIT_SYNCED_HE); // gcal/gmail row → refuse, NO write
    return;
  }
  await applyPatchToId(deps, msg, candidate.id, patch);
}
