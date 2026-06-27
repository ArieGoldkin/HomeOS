import type { SavedEvent } from "../../../db/event-store/index.ts";
import type { InboundMessage } from "../../../http/webhook.ts";
import {
  bulkCancelConfirmPrompt,
  CANCEL_WHICH_HE,
  cancelConfirmPrompt,
  conversationExpiresAt,
  formatWhen,
  type HandlerDeps,
  REPHRASE_HE,
} from "../shared/index.ts";

/**
 * #163 — open a BULK confirm-before-destroy thread: a `cancel` thread holding ALL in-scope ids + the
 * `confirmAll` discriminator (reuses the existing kind — NO migration), plus a prompt listing the set.
 * `resumeCancel`'s `confirmAll` branch resolves it with a fail-closed כן. No store ⇒ can't confirm ⇒ no
 * delete (rephrase). The set is already capped at BULK_CANCEL_MAX by findEventsInScope, so the payload
 * always fits cancelPayloadSchema.
 */
export async function openBulkCancelConfirm(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidates: SavedEvent[],
): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!deps.conversations) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "cancel", candidateIds: candidates.map((e) => e.id), confirmAll: true },
    expiresAt: conversationExpiresAt(deps),
  });
  log("bulk cancel confirm opened", { from: msg.from, count: candidates.length });
  await deps.sendText(msg.from, bulkCancelConfirmPrompt(candidates));
}

/**
 * #147 — open a CONFIRM-before-destroy thread for an agentic 1-match cancel: a single-candidate `cancel`
 * thread (reuses the existing kind — no migration) + a `כן/לא` prompt. Resolved by `resumeCancel`'s
 * fail-closed `isAffirmative`. No conversations store ⇒ we can't confirm, so we DON'T delete (rephrase).
 */
export async function openCancelConfirm(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidate: SavedEvent,
): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!deps.conversations) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "cancel", candidateIds: [candidate.id] },
    expiresAt: conversationExpiresAt(deps),
  });
  log("cancel confirm opened (agentic 1-match)", { from: msg.from, id: candidate.id });
  await deps.sendText(msg.from, cancelConfirmPrompt(candidate));
}

/** #85/#147 — open a numbered disambiguation thread (N>1), shared by the deterministic and agentic paths. */
export async function openCancelDisambiguation(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidates: SavedEvent[],
): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!deps.conversations) {
    await deps.sendText(msg.from, REPHRASE_HE); // no store wired → can't disambiguate
    return;
  }
  const list = candidates.map((e, i) => `${i + 1}. ${e.title_he} · ${formatWhen(e)}`).join("\n");
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "cancel", candidateIds: candidates.map((e) => e.id) },
    expiresAt: conversationExpiresAt(deps),
  });
  log("cancel-by-ref disambiguation opened", { from: msg.from, count: candidates.length });
  await deps.sendText(msg.from, `${CANCEL_WHICH_HE}\n${list}`);
}
