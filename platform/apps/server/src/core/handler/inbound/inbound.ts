import type { InboundOutcome } from "@homeos/shared";
import type { ConversationRow } from "../../../db/schema.ts";
import type { InboundMessage } from "../../../http/webhook.ts";
import { TransientError } from "../../errors.ts";
import { sqliteUtc } from "../../time.ts";
import { routeCancelByRef } from "../cancel/index.ts";
import { routeEditByRef } from "../edit/index.ts";
import {
  CANCEL_REF_RE,
  CANCEL_TRIGGER,
  cancelReply,
  EDIT_REF_RE,
  familyOf,
  type HandlerDeps,
  jerusalemToday,
  MAX_INPUT,
  type ProcessDeps,
  REFUSAL_HE,
  REPHRASE_HE,
  stripLeadingFiller,
  TEXT_ONLY_HE,
} from "../shared/index.ts";
import { tryBindPhone } from "./components/binding.ts";
import { enforceRateCeiling, resolveFamilyOrSkip } from "./components/gates.ts";
import { runParseAndConfirm } from "./components/parse-and-confirm.ts";
import { CONTINUE } from "./components/phase.ts";
import { routeOpenThread } from "./components/resume-routing.ts";
import { trySyncTriggers } from "./components/sync-triggers.ts";

/**
 * M2 inbound handling: admission gate → parse (Claude) → persist → Hebrew confirm.
 * Voice/media is deferred to M2b, so non-text messages get a friendly "text only" reply.
 * Dedupe + durability now live in the inbound queue (the message is persisted before the
 * ack and de-duped on wa_message_id); `processInbound` wraps this and settles the row.
 *
 * The body is a THIN ORDERED SPINE (G22: order is load-bearing): each phase is a `components/` helper
 * that either HANDLED the message — return its outcome — or signals {@link CONTINUE} to fall through.
 * The shared per-request state (the #229 `rdeps` clone, the single clock `now`, the single `getPending`)
 * is produced here once and threaded down (#87/F4); command routes get `rdeps`, the sync/parse paths get
 * `deps` + an explicit `family`, exactly as the unsplit handler did.
 *
 * #135/#159 — returns the FINER terminal {@link InboundOutcome} for the messages feed: each parse-path
 * branch returns its disposition (refused/rate_limited/text_only/rephrase/clarified/parsed) AND each
 * command path returns its route-level disposition (aborted/edited/resumed/cancelled/synced) so the feed
 * shows what the bot DID instead of a blank pill. `undefined` remains only where there's genuinely no
 * disposition (a "connect Google first" reply on an unconnected sync). `processInbound` threads this into
 * `markDone`. A thrown TransientError leaves the row pending (no outcome recorded).
 */
export async function handleInbound(
  msg: InboundMessage,
  deps: HandlerDeps,
): Promise<InboundOutcome | undefined> {
  const log = deps.log ?? (() => {});

  // 🔗 #228 phone-binding ceremony — the ONE deliberate pre-gate branch (no code ⇒ CONTINUE).
  const bound = await tryBindPhone(msg, deps);
  if (bound !== CONTINUE) return bound;

  // 🔒🔑 #259/#229 — the admission gate AND the family resolve, unified (BEFORE any write/model call). A
  // sender is admitted iff it resolves to a family in family_phones (the DB-backed allowlist — so a #228-
  // bound phone works with no ALLOWLIST redeploy); dev/tests with no resolver fall back to the static list.
  // `"refused"` ⇒ send the Hebrew refusal and skip WITHOUT writing — never FAMILY_ID="default". The resolved
  // id threads down on the per-request deps clone (`rdeps`), read everywhere via `familyOf`/the `family` local.
  const resolved = resolveFamilyOrSkip(msg, deps);
  if (resolved === "refused") {
    await deps.sendText(msg.from, REFUSAL_HE);
    return "refused";
  }
  const rdeps = resolved;
  const family = familyOf(rdeps);

  // Read the clock ONCE for the whole handler (#87/F4): the G16 rate gate, the date anchor, and the
  // resume lookup all reuse it — no split-brain, no redundant Date() construction.
  const now = (deps.now ?? (() => new Date()))();

  // #83 sweep + open-thread lookup, computed ONCE here (#87/F4): a single getPending feeds BOTH the G23
  // rate exemption below AND the resume routing further down (no double read, no expire-between-reads
  // window). expireStale runs first (G24 boot+per-inbound) so an expired question never counts as open.
  // Inert unless `conversations` is wired, so the branch is fully additive.
  let pending: ConversationRow | null = null;
  if (deps.conversations) {
    const nowSqlite = sqliteUtc(now);
    deps.conversations.expireStale(nowSqlite);
    pending = deps.conversations.getPending(msg.from, nowSqlite);
  }

  // G16: per-sender daily ceiling (with the G23 open-thread exemption — `pending` looked up above).
  const rate = await enforceRateCeiling(msg, deps, now, pending);
  if (rate !== CONTINUE) return rate;

  // M2a is text-only; voice/images land in M2b.
  const text = msg.text?.trim();
  if (!text) {
    await deps.sendText(msg.from, TEXT_ONLY_HE);
    return "text_only";
  }

  const today = jerusalemToday(now);

  // G2: input-length cap — short-circuit BEFORE any model call, including the clarify-RESUME re-parse
  // below (an answer to "מתי זה?" is model-bound too). Placed ahead of the resume + exact-match triggers
  // (ביטול/syncs are short, so capping them is harmless) so no path can send Claude an oversized payload.
  if (text.length > MAX_INPUT) {
    log("input over MAX_INPUT — rephrase", { id: msg.id, len: text.length });
    await deps.sendText(msg.from, REPHRASE_HE);
    return "rephrase";
  }

  // #83 RESUME — when a thread is open, the next message is its ANSWER (G22 order: after the gates +
  // text-only guard, before ביטול / any agent.run). routeOpenThread handles abort/correction/resume, or
  // CONTINUEs when a fresh verb-led command / new forward should override the thread (resolving it first).
  if (pending) {
    const routed = await routeOpenThread(rdeps, msg, pending, today, text);
    if (routed !== CONTINUE) return routed;
  }

  // Undo: a bare "ביטול" removes the sender's last message's events — caught before parse so it's never
  // sent to Claude. The confirm (with the resolved Hebrew date) is what makes a misparse catchable; this
  // is the recovery. #229: scoped by SENDER phone (not the resolved family) — a phone belongs to exactly
  // one family, so this is already family-isolated; it leans on the same one-phone-one-family invariant
  // the resolver does, not on the threaded `family`.
  if (text === CANCEL_TRIGGER) {
    const removed = deps.events.deleteLastFromSender(msg.from);
    log("cancel", { from: msg.from, removed });
    await deps.sendText(msg.from, cancelReply(removed));
    return "cancelled";
  }

  // The bare sync commands (Gmail #72 "סנכרן מייל" / Calendar #18 "סנכרן יומן") — deterministic, opt-in;
  // not-connected ⇒ "connect first" (handled, no disposition); not a sync command ⇒ CONTINUE.
  const synced = await trySyncTriggers(deps, msg, text, today, family);
  if (synced !== CONTINUE) return synced;

  // Strip a leading conversational filler ("טוב"/"אוקיי"…) for the deterministic verb-led commands so
  // "טוב בטל…" / "אוקיי שנה…" route like the bare form. ONLY the route tests + extraction see this; the
  // fall-through to agent.run keeps the ORIGINAL text, so a non-command is never mangled (G22 preserved:
  // the route still needs a verb at the start AND a real board match before anything is deleted/edited).
  const command = stripLeadingFiller(text);

  // #85 cancel-BY-REFERENCE: a deterministic route (NO model call) — "בטל/מחק/הסר <ref>" (+ inflections).
  // The reference is extracted SERVER-side; findEventsByRef scopes to the family's board rows
  // (source_provider IS NULL). 0 → not-found; 1 → delete + best-effort Google delete; N>1 → a numbered
  // disambiguation thread (never auto-pick — the board is shared, G20). A forward that merely CONTAINS
  // "בטל…" deletes nothing unless a real board event matches (state-not-content, G22).
  if (CANCEL_REF_RE.test(command)) {
    await routeCancelByRef(rdeps, msg, command, today);
    return "cancelled";
  }

  // #86 EXPLICIT EDIT: "שנה/ערוך/תקן/עדכן <ref> ל-<field>" — deterministic (NO model call). Needs a
  // recognized field delta AND a specific reference; 0 (לא מצאתי) | 1 (apply, refusing a synced row) |
  // N>1 (numbered kind='edit' thread holding the patch). Same family/state-not-content guards as cancel.
  if (EDIT_REF_RE.test(command)) {
    await routeEditByRef(rdeps, msg, command, today);
    return "edited";
  }

  // The agent (parse) path — the terminal phase (no deterministic route handled the message).
  return runParseAndConfirm(deps, msg, text, today, family);
}

/**
 * Process one persisted inbound and settle its queue row. Used both for live messages (after
 * `inbound.enqueue`) and on boot-replay of `pending` rows. markDone on success; markFailed on
 * throw, so a poison message isn't replayed forever (item J later adds transient-vs-permanent
 * retry; today a failure is terminal + visible in the row's status).
 */
export async function processInbound(msg: InboundMessage, deps: ProcessDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  try {
    // #135 — settle the row with the finer disposition the handler reached (null for command paths).
    const outcome = await handleInbound(msg, deps);
    deps.inbound.markDone(msg.id, outcome);
  } catch (err) {
    if (err instanceof TransientError) {
      // Leave the row `pending` (don't settle) so boot-replay retries it — a service blip
      // shouldn't lose the message. NOT a DLQ; just "try again next boot".
      log("transient failure — left pending for replay", { id: msg.id });
      return;
    }
    deps.inbound.markFailed(msg.id);
    log("processInbound failed", { id: msg.id, error: String(err) });
  }
}
