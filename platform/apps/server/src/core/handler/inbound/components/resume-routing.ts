import type { InboundOutcome } from "@homeos/shared";
import type { ConversationRow } from "../../../../db/schema.ts";
import type { InboundMessage } from "../../../../http/webhook.ts";
import { applyCorrection } from "../../correction.ts";
import { handleResume } from "../../resume.ts";
import {
  ABORT_THREAD_HE,
  CANCEL_REF_RE,
  CANCEL_TRIGGER,
  CORRECTION_RE,
  EDIT_REF_RE,
  type HandlerDeps,
  hasScheduleSignal,
  stripLeadingFiller,
} from "../../shared/index.ts";
import { CONTINUE } from "./phase.ts";

/**
 * #83 RESUME branch (Milestone #8) — ORDER IS LOAD-BEARING (G22): the spine calls this only when the
 * sender has an open thread (`pending`), AFTER the allowlist + G16 rate gate + text-only guard and
 * BEFORE ביטול / any agent.run. The sender's next message is an ANSWER → route it to the deterministic
 * resume, never re-parse it as a fresh forward (G17). `pending` non-null ⇒ `conversations` is set, so the
 * `?.` calls always run. Returns a handled {@link InboundOutcome}, or {@link CONTINUE} when a fresh
 * verb-led command / new forward should override the thread (after resolving it). (`rdeps` is the #229
 * deps clone; `rdeps.conversations`/`rdeps.sendText` are the same instances the unsplit handler used.)
 */
export async function routeOpenThread(
  rdeps: HandlerDeps,
  msg: InboundMessage,
  pending: ConversationRow,
  today: string,
  text: string,
): Promise<InboundOutcome | typeof CONTINUE> {
  const log = rdeps.log ?? (() => {});
  // Bare "ביטול" is the universal escape hatch: it ABORTS the open thread (resolve, NO undo) — the
  // open op takes precedence over the last-message undo (§2).
  if (text === CANCEL_TRIGGER) {
    rdeps.conversations?.resolve(pending.id);
    log("aborted open thread via ביטול", { from: msg.from, id: pending.id });
    await rdeps.sendText(msg.from, ABORT_THREAD_HE);
    return "aborted";
  }
  // #86 CORRECTION: a terse "לא ב-/בשעה/במיקום …" corrects the held draft IN PLACE (G21).
  if (CORRECTION_RE.test(text)) {
    await applyCorrection(rdeps, msg, pending, today);
    return "edited";
  }
  // #207 — a fresh VERB-LED command (cancel/edit) takes precedence over the open thread: abort it and
  // let the deterministic routes (back in the spine) handle the command, exactly as bare ביטול aborts.
  // Without this, a "תבטל …" / "שנה …" typed while a clarify/disambiguation thread is open is swallowed
  // as the thread's answer — the live bug where "תבטל את הגישה עם רות מחר" became a new event's title.
  // Edge: a legit `ambiguous_title` answer that itself starts with a cancel/edit verb is now routed as a
  // command — rare, and benign: G22's specific-ref + real-board-match guard yields a "not found" (the
  // draft is dropped, nothing is deleted/edited), strictly better than the junk event this fixes.
  const stripped = stripLeadingFiller(text);
  const isVerbLedCommand = CANCEL_REF_RE.test(stripped) || EDIT_REF_RE.test(stripped);
  // #86 false-positive guard: a "לא …" that ISN'T a field correction but DOES carry a date/time
  // (e.g. "לא נשכח את יום ההולדת ביום שישי") is a NEW forward, not a thread answer — abort the thread
  // and let it fall through to agent.run. A bare "לא יודע" (no schedule signal) is just a non-answer
  // → handleResume (→ rephrase / re-parse). Any other message is the thread's answer → handleResume.
  const isNewForward = /^לא[\s,]/u.test(text) && hasScheduleSignal(text);
  if (isVerbLedCommand || isNewForward) {
    rdeps.conversations?.resolve(pending.id);
    log(
      isVerbLedCommand
        ? "verb-led command overrides open thread → route as command"
        : "non-correction 'לא' with a schedule signal → new forward",
      { from: msg.from },
    );
    return CONTINUE;
  }
  await handleResume(rdeps, msg, pending);
  return "resumed";
}
