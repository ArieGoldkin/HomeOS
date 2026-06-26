import type { InboundMessage } from "../../../http/webhook.ts";
import {
  CANCEL_NOT_FOUND_HE,
  familyOf,
  type HandlerDeps,
  resolveCandidates,
} from "../shared/index.ts";
import { cancelOne } from "./delete.ts";
import { extractBulkCancel, extractCancelRef } from "./extract.ts";
import { openBulkCancelConfirm, openCancelConfirm, openCancelDisambiguation } from "./threads.ts";

/**
 * #85 cancel-BY-REFERENCE route (deterministic, NO model call) — "בטל/מחק/הסר <ref>". The reference is
 * extracted SERVER-side; findEventsByRef scopes to the family's board rows (source_provider IS NULL).
 * 0 → not-found; 1 → delete + best-effort Google delete; N>1 → a numbered disambiguation thread (never
 * auto-pick — the board is shared, G20). #125/F1 — require a SPECIFIC reference (time, date, or a title
 * hint of ≥2 chars) before touching the board, so a bare verb or a coincidental forward starting with
 * בטל must NOT silently delete (state-not-content, G22).
 */
export async function routeCancelByRef(
  deps: HandlerDeps,
  msg: InboundMessage,
  text: string,
  today: string,
): Promise<void> {
  // #163 — a BULK cancel ("בטל את כל הפגישות מחר") takes precedence over the single-target path: the
  // quantifier "כל ה…" would otherwise be mis-read as a title hint and match nothing (the live miss).
  const bulk = extractBulkCancel(text, today);
  if (bulk) {
    await routeBulkCancel(deps, msg, bulk);
    return;
  }
  const ref = extractCancelRef(text, today);
  const specific = Boolean(ref.time || ref.dateIso || (ref.titleHint && ref.titleHint.length >= 2));
  if (!specific) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  const candidates = deps.events.findEventsByRef(familyOf(deps), ref);
  // Deterministic exact-match path (Option B — UNCHANGED): 1 → delete immediately; N>1 → numbered thread.
  if (candidates.length === 1) {
    await cancelOne(deps, msg, candidates[0]!.id);
    return;
  }
  if (candidates.length > 1) {
    await openCancelDisambiguation(deps, msg, candidates);
    return;
  }
  // 0 deterministic matches → AGENTIC fallback (#147): the model resolves the reference over
  // title+location+assignee (the live bug), then we CONFIRM before destroying. resolveAgent unwired ⇒
  // `null` ⇒ behave exactly as before (not-found). A TransientError propagates (→ pending/replay).
  const resolved = await resolveCandidates(deps, msg, text, ref, today);
  if (resolved === null || resolved.length === 0) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  if (resolved.length === 1) {
    await openCancelConfirm(deps, msg, resolved[0]!);
    return;
  }
  await openCancelDisambiguation(deps, msg, resolved);
}

/**
 * #163 — route a BULK cancel: list EVERY board row in the date/time scope, then confirm-before-destroy the
 * whole set. 0 matches → not-found (no thread). The scope is always non-empty here (extractBulkCancel
 * requires it), so this never lists the entire board.
 */
async function routeBulkCancel(
  deps: HandlerDeps,
  msg: InboundMessage,
  scope: { dateIso?: string; time?: string },
): Promise<void> {
  const candidates = deps.events.findEventsInScope(familyOf(deps), scope);
  if (candidates.length === 0) {
    await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
    return;
  }
  await openBulkCancelConfirm(deps, msg, candidates);
}
