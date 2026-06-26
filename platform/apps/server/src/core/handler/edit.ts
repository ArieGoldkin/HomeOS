import { sanitizeUserText } from "@homeos/shared";
import { editPayloadSchema } from "../../db/conversation-store.ts";
import type { EventPatch, SavedEvent } from "../../db/event-store.ts";
import type { ConversationRow } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { pushSavedEventsToCalendar } from "../../tools/tools.ts";
import { extractCancelRef, parseSelection } from "./cancel.ts";
import {
  CANCEL_NOT_FOUND_HE,
  CONFIRM_ABORT_HE,
  conversationExpiresAt,
  EDIT_DAY_RE,
  EDIT_LOCATION_RE,
  EDIT_SYNCED_HE,
  EDIT_TIME_RE,
  EDIT_WHICH_HE,
  editConfirmPrompt,
  familyOf,
  formatWhen,
  type HandlerDeps,
  isAffirmative,
  REPHRASE_HE,
  resolveCandidates,
  safeJsonParse,
} from "./shared/index.ts";

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
async function applyPatchToMany(
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
  const ids = parsed.data.candidateIds;
  const reply = msg.text?.trim() ?? "";
  // #147 — a SINGLE-candidate thread is a confirm-before-edit (the agentic 1-match): FAIL-CLOSED, only an
  // anchored כן applies the held patch; לא / a non-answer aborts with no write (applyPatchToId is also
  // board-only, so a synced id could never be written even if it slipped in).
  if (ids.length === 1) {
    if (isAffirmative(reply)) {
      await applyPatchToId(deps, msg, ids[0]!, parsed.data.patch);
    } else {
      log("edit confirm declined / non-affirmative — no write (fail-closed)", { from: msg.from });
      await deps.sendText(msg.from, CONFIRM_ABORT_HE);
    }
    return;
  }
  // N>1 — a disambiguation thread (#161): a SINGLE reply may pick one OR MORE candidates ("1", "1,2",
  // "1 ו-2") or הכל/כולם → apply the held patch to ALL of them; any non-selection reply writes nothing.
  const picks = parseSelection(reply, ids.length);
  if (picks.length === 0) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  await applyPatchToMany(
    deps,
    msg,
    picks.map((n) => ids[n - 1]!),
    parsed.data.patch,
  );
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
  const edit = extractEditDelta(text, today);
  const ref = edit?.ref;
  const specific = Boolean(
    ref?.time || ref?.dateIso || (ref?.titleHint && ref.titleHint.length >= 2),
  );
  if (!edit || !specific) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  const candidates = deps.events.findEventsByRef(familyOf(deps), edit.ref);
  // Deterministic exact-match path (Option B — UNCHANGED): 1 → apply immediately; N>1 → numbered thread.
  if (candidates.length === 1) {
    await applyEdit(deps, msg, candidates[0]!, edit.patch);
    return;
  }
  if (candidates.length > 1) {
    await openEditDisambiguation(deps, msg, candidates, edit.patch);
    return;
  }
  // 0 deterministic matches → AGENTIC fallback (#147): resolve over title+location+assignee, CONFIRM before
  // editing. resolveAgent unwired ⇒ null ⇒ behave exactly as before (not-found). TransientError propagates.
  const resolved = await resolveCandidates(deps, msg, text, edit.ref, today);
  if (resolved === null || resolved.length === 0) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  if (resolved.length === 1) {
    await openEditConfirm(deps, msg, resolved[0]!, edit.patch);
    return;
  }
  await openEditDisambiguation(deps, msg, resolved, edit.patch);
}

/**
 * #147 — open a CONFIRM-before-edit thread for an agentic 1-match: a single-candidate `edit` thread holding
 * the patch (reuses the existing kind — no migration) + a `כן/לא` prompt. Resolved by `resumeEdit`'s
 * fail-closed `isAffirmative`. No conversations store ⇒ we can't confirm, so we DON'T write (rephrase).
 */
async function openEditConfirm(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidate: SavedEvent,
  patch: EventPatch,
): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!deps.conversations) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "edit", candidateIds: [candidate.id], patch },
    expiresAt: conversationExpiresAt(deps),
  });
  log("edit confirm opened (agentic 1-match)", { from: msg.from, id: candidate.id });
  await deps.sendText(msg.from, editConfirmPrompt(candidate));
}

/** #86/#147 — open a numbered edit-disambiguation thread (N>1) holding the patch, shared by both paths. */
async function openEditDisambiguation(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidates: SavedEvent[],
  patch: EventPatch,
): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!deps.conversations) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const list = candidates.map((e, i) => `${i + 1}. ${e.title_he} · ${formatWhen(e)}`).join("\n");
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "edit", candidateIds: candidates.map((e) => e.id), patch },
    expiresAt: conversationExpiresAt(deps),
  });
  log("edit disambiguation opened", { from: msg.from, count: candidates.length });
  await deps.sendText(msg.from, `${EDIT_WHICH_HE}\n${list}`);
}
