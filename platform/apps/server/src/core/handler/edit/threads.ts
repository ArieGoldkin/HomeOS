import type { EventPatch, SavedEvent } from "../../../db/event-store/index.ts";
import type { InboundMessage } from "../../../http/webhook.ts";
import {
  conversationExpiresAt,
  EDIT_WHICH_HE,
  editConfirmPrompt,
  formatWhen,
  type HandlerDeps,
  REPHRASE_HE,
} from "../shared/index.ts";

/**
 * #147 — open a CONFIRM-before-edit thread for an agentic 1-match: a single-candidate `edit` thread holding
 * the patch (reuses the existing kind — no migration) + a `כן/לא` prompt. Resolved by `resumeEdit`'s
 * fail-closed `isAffirmative`. No conversations store ⇒ we can't confirm, so we DON'T write (rephrase).
 */
export async function openEditConfirm(
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
export async function openEditDisambiguation(
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
