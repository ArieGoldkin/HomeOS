import type { InboundMessage } from "../../../http/webhook.ts";
import {
  CANCEL_NOT_FOUND_HE,
  familyOf,
  type HandlerDeps,
  resolveCandidates,
} from "../shared/index.ts";
import { applyEdit } from "./apply.ts";
import { extractEditDelta } from "./extract.ts";
import { openEditConfirm, openEditDisambiguation } from "./threads.ts";

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
