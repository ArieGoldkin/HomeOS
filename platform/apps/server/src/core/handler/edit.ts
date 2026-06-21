import { sanitizeUserText } from "@homeos/shared";
import { editPayloadSchema } from "../../db/conversation-store.ts";
import type { EventPatch, SavedEvent } from "../../db/event-store.ts";
import { type ConversationRow, FAMILY_ID } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { pushSavedEventsToCalendar } from "../../tools/tools.ts";
import { sqliteUtc } from "../time.ts";
import { extractCancelRef } from "./cancel.ts";
import {
  CANCEL_NOT_FOUND_HE,
  CANCEL_WHICH_HE,
  CONVERSATION_TTL_MS,
  EDIT_DAY_RE,
  EDIT_LOCATION_RE,
  EDIT_SYNCED_HE,
  EDIT_TIME_RE,
  formatWhen,
  type HandlerDeps,
  REPHRASE_HE,
  safeJsonParse,
} from "./shared.ts";

/**
 * #86 — extract an explicit-edit REFERENCE + a field DELTA from a fixed vocabulary (server-side, NO
 * model call). Returns null when no recognized delta is present, so "שנה X" without a `ל-<field>` is a
 * miss (not a no-op write). "ל-DD" resolves to that day of TODAY's month (cross-month is a #87 item).
 */
export function extractEditDelta(
  text: string,
  todayIso: string,
): { ref: { dateIso?: string; time?: string; titleHint?: string }; patch: EventPatch } | null {
  let rest = text.replace(/^(שנה|ערוך|תקן|עדכן)\s+/u, "");
  const patch: EventPatch = {};
  const loc = EDIT_LOCATION_RE.exec(rest);
  if (loc?.[1]) {
    patch.location = sanitizeUserText(loc[1].trim());
    rest = rest.replace(EDIT_LOCATION_RE, " ");
  }
  const tm = EDIT_TIME_RE.exec(rest);
  if (tm?.[1] && tm[2]) {
    patch.time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
    rest = rest.replace(EDIT_TIME_RE, " ");
  }
  const dy = EDIT_DAY_RE.exec(rest);
  if (dy?.[1]) {
    patch.date_iso = `${todayIso.slice(0, 8)}${String(Number(dy[1])).padStart(2, "0")}`;
    rest = rest.replace(EDIT_DAY_RE, " ");
  }
  if (Object.keys(patch).length === 0) return null;
  return { ref: extractCancelRef(rest, todayIso), patch };
}

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
  const updated = deps.events.updateEvent(id, patch, FAMILY_ID);
  if (!updated) {
    await deps.sendText(msg.from, REPHRASE_HE); // synced row / invalid merge → no write happened
    return;
  }
  if (deps.calendar) {
    await pushSavedEventsToCalendar([updated], deps.calendar, FAMILY_ID, log); // G25 best-effort
  }
  log("edit applied", { from: msg.from, id: updated.id });
  await deps.sendText(msg.from, `עודכן ✓\n${updated.title_he} · ${formatWhen(updated)}`);
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

/**
 * #86 — resume an edit disambiguation: a numbered reply picks ONE candidate → apply the held patch
 * (updateEvent enforces board-only, so a synced id can't be written). Non-index → no write. Single-use.
 */
export async function resumeEdit(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});
  deps.conversations?.resolve(row.id); // single-use (turn cap 1)
  const parsed = editPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  if (!parsed.success) {
    log("edit resume — invalid persisted payload", { from: msg.from, id: row.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const m = /^([1-5])$/.exec(msg.text?.trim() ?? "");
  const id = m?.[1] ? parsed.data.candidateIds[Number(m[1]) - 1] : undefined;
  if (id === undefined) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  await applyPatchToId(deps, msg, id, parsed.data.patch);
}

/**
 * #86 EXPLICIT EDIT route: "שנה/ערוך/תקן/עדכן <ref> ל-<field>" — deterministic (NO model call). Needs a
 * recognized field delta AND a specific reference; 0 (לא מצאתי) | 1 (apply, refusing a synced row) |
 * N>1 (numbered kind='edit' thread holding the patch). Same family/state-not-content guards as cancel.
 */
export async function routeEditByRef(
  deps: HandlerDeps,
  msg: InboundMessage,
  text: string,
  today: string,
): Promise<void> {
  const log = deps.log ?? (() => {});
  const edit = extractEditDelta(text, today);
  const ref = edit?.ref;
  const specific = Boolean(
    ref?.time || ref?.dateIso || (ref?.titleHint && ref.titleHint.length >= 2),
  );
  if (!edit || !specific) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  const candidates = deps.events.findEventsByRef(FAMILY_ID, edit.ref);
  if (candidates.length === 0) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  if (candidates.length === 1) {
    await applyEdit(deps, msg, candidates[0]!, edit.patch);
    return;
  }
  if (deps.conversations) {
    const list = candidates.map((e, i) => `${i + 1}. ${e.title_he} · ${formatWhen(e)}`).join("\n");
    const expiresAt = sqliteUtc(
      new Date(
        (deps.now ?? (() => new Date()))().getTime() +
          (deps.conversationTtlMs ?? CONVERSATION_TTL_MS),
      ),
    );
    deps.conversations.create({
      fromPhone: msg.from,
      payload: { kind: "edit", candidateIds: candidates.map((e) => e.id), patch: edit.patch },
      expiresAt,
    });
    log("edit disambiguation opened", { from: msg.from, count: candidates.length });
    await deps.sendText(msg.from, `${CANCEL_WHICH_HE}\n${list}`);
  } else {
    await deps.sendText(msg.from, REPHRASE_HE);
  }
}
