import { type ParsedEvent, parsedEventSchema, sanitizeUserText } from "@homeos/shared";
import { clarifyPayloadSchema } from "../../db/conversation-store.ts";
import { type ConversationRow, FAMILY_ID } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { type ClarifyResult, pushSavedEventsToCalendar } from "../../tools/tools.ts";
import { sqliteUtc } from "../time.ts";
import {
  CLARIFY_QUESTIONS,
  CONVERSATION_TTL_MS,
  formatConfirm,
  type HandlerDeps,
  jerusalemToday,
  REPHRASE_HE,
  safeJsonParse,
} from "./shared.ts";

/**
 * #84 — complete a clarify draft from the sender's answer, then save + confirm. Turn cap = 1: the
 * thread is resolved (DELETEd) once this turn is consumed, so a second answer finds nothing pending and
 * falls through to a fresh parse. The raw answer NEVER enters an auto agent turn (G17): `ambiguous_title`
 * takes the answer verbatim as the title; `missing_date` re-resolves it through the non-persisting
 * `parse` seam (a single structured call). RESOLVE happens AFTER the (possibly-throwing) re-parse so a
 * `TransientError` leaves the thread intact for boot-replay (F2); the persisted payload is re-validated
 * (F3) and the merged event re-validated by `parsedEventSchema` BEFORE the write (G20). Any failure
 * abandons the draft with REPHRASE_HE.
 */
export async function resumeClarify(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});

  // F3: the persisted blob is trusted-but-VERIFY — a corrupt/stale/tampered row degrades to rephrase,
  // never crashes on access nor saves garbage. Consume the thread (it can't be completed) and bail.
  const parsed = clarifyPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  if (!parsed.success) {
    deps.conversations?.resolve(row.id);
    log("clarify resume — invalid persisted payload", { from: msg.from, id: row.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const payload = parsed.data;
  const answer = msg.text?.trim() ?? "";
  let merged: ParsedEvent | null = null;

  if (payload.reason === "ambiguous_title") {
    // The answer IS the title — sanitize (G15); safeParse bounds it (G1).
    merged = {
      ...payload.draft,
      title_he: sanitizeUserText(answer),
      needs_clarification: undefined,
    };
  } else if (deps.parse) {
    // missing_date: re-resolve the date through the parser FIRST (no save). A TransientError propagates
    // with the thread STILL OPEN (F2) so boot-replay retries; the answer is already ≤ MAX_INPUT (G2).
    const today = jerusalemToday((deps.now ?? (() => new Date()))());
    const a = (await deps.parse(answer, today, deps.members?.[msg.from]))?.[0];
    if (a) {
      merged = {
        ...payload.draft,
        date_iso: a.date_iso,
        time: a.time ?? payload.draft.time,
        needs_clarification: undefined,
      };
    }
  }

  // Past any model call without a transient throw → consume the thread now (single-use, turn cap 1).
  deps.conversations?.resolve(row.id);

  const validated = merged ? parsedEventSchema.safeParse(merged) : null;
  if (!validated?.success) {
    log("clarify resume — could not complete the draft", {
      from: msg.from,
      reason: payload.reason,
    });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }

  const saved = deps.events.saveEvent(validated.data, { fromPhone: msg.from, waMessageId: msg.id });
  log("clarify resume — saved", { from: msg.from, id: saved.id });
  await deps.sendText(msg.from, formatConfirm([saved]));

  // Auto-push to Calendar — the same best-effort follower as the main forward path (#18 chunk 2).
  if (deps.autoPushCalendar && deps.calendar) {
    const { pushed } = await pushSavedEventsToCalendar([saved], deps.calendar, FAMILY_ID, log);
    if (pushed > 0) log("auto-pushed clarify resume to calendar", { id: msg.id, pushed });
  }
}

/**
 * #84 — open a clarify thread: pick the SERVER-OWNED template for the model's reason enum, persist the
 * draft on a `kind:'clarify'` thread (#83 store), send ONE question, save NOTHING, no confirm. No
 * template (or no store wired) → REPHRASE_HE. processInbound marks the inbound done on normal return, so
 * boot-replay never re-asks (the conversation row carries the open state). Red-line: the user only ever
 * sees a server template, never model prose.
 */
export async function openClarifyThread(
  deps: HandlerDeps,
  msg: InboundMessage,
  clarify: ClarifyResult,
): Promise<void> {
  const log = deps.log ?? (() => {});
  const question = CLARIFY_QUESTIONS[clarify.reason];
  if (!question || !deps.conversations) {
    log("clarify — no template or no store; degrading", { from: msg.from, reason: clarify.reason });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const expiresAt = sqliteUtc(
    new Date(
      (deps.now ?? (() => new Date()))().getTime() +
        (deps.conversationTtlMs ?? CONVERSATION_TTL_MS),
    ),
  );
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "clarify", reason: clarify.reason, draft: clarify.draft },
    expiresAt,
  });
  log("clarify thread opened", { from: msg.from, reason: clarify.reason });
  await deps.sendText(msg.from, question);
}
