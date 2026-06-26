import type { InboundOutcome } from "@homeos/shared";
import type { SavedEvent } from "../../db/event-store/index.ts";
import type { ConversationRow } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import { pushSavedEventsToCalendar } from "../../tools/index.ts";
import type { AgentResult } from "../agent.ts";
import { isAllowed } from "../allowlist.ts";
import { TransientError } from "../errors.ts";
import { jerusalemDayStartSqlite, sqliteUtc } from "../time.ts";
import { routeCancelByRef } from "./cancel/index.ts";
import { openClarifyThread } from "./clarify.ts";
import { applyCorrection } from "./correction.ts";
import { routeEditByRef } from "./edit.ts";
import { handleResume } from "./resume.ts";
import {
  ABORT_THREAD_HE,
  BIND_INVALID_HE,
  BIND_OK_HE,
  BIND_WRONG_FAMILY_HE,
  BINDING_CODE_RE,
  CAL_NOT_CONNECTED_HE,
  CANCEL_REF_RE,
  CANCEL_TRIGGER,
  CORRECTION_RE,
  cancelReply,
  clarifyOf,
  EDIT_REF_RE,
  familyOf,
  formatAlready,
  formatConfirm,
  type HandlerDeps,
  hasScheduleSignal,
  jerusalemToday,
  MAX_INPUT,
  NOT_CONNECTED_HE,
  type ProcessDeps,
  RATE_LIMIT_HE,
  REFUSAL_HE,
  REPHRASE_HE,
  SYNC_CAL_INTENT,
  SYNC_CAL_NONE_HE,
  SYNC_CAL_TRIGGER,
  SYNC_INTENT,
  SYNC_MAIL_TRIGGER,
  SYNC_NONE_HE,
  savedOf,
  stripLeadingFiller,
  TEXT_ONLY_HE,
  TRANSIENT_HE,
} from "./shared/index.ts";
import { runSyncIntent } from "./sync.ts";

/**
 * M2 inbound handling: allowlist gate → parse (Claude) → persist → Hebrew confirm.
 * Voice/media is deferred to M2b, so non-text messages get a friendly "text only" reply.
 * Dedupe + durability now live in the inbound queue (the message is persisted before the
 * ack and de-duped on wa_message_id); `processInbound` wraps this and settles the row.
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

  // 🔗 #228 phone-binding ceremony — the ONE deliberate pre-allowlist branch: a not-yet-bound phone is by
  // definition not on the allowlist, and binding is the act that CREATES the allowlist entry, so it must be
  // handled before the gate would reject it. Cheap on the miss path (one regex; the indexed lookup runs
  // ONLY when a code-shaped token is present), so it doesn't widen the pre-auth cost surface. Only a VALID
  // pending code writes anything; a valid bind short-circuits all command routing. Fully additive: unset
  // `deps.bindings` ⇒ no branch. No code ⇒ fall through to the unchanged allowlist gate below.
  if (deps.bindings) {
    const code = msg.text?.toUpperCase().match(BINDING_CODE_RE)?.[0];
    if (code) {
      const result = deps.bindings.matchBinding(code, msg.from);
      if (result?.status === "bound") {
        log("phone bound", { from: msg.from, familyId: result.familyId });
        await deps.sendText(msg.from, BIND_OK_HE);
        return "bound";
      }
      if (result?.status === "wrong_family") {
        log("phone bind rejected — already bound to another family", { from: msg.from });
        await deps.sendText(msg.from, BIND_WRONG_FAMILY_HE);
        return "refused";
      }
      log("phone bind failed — invalid or expired code", { from: msg.from });
      await deps.sendText(msg.from, BIND_INVALID_HE);
      return "refused";
    }
  }

  // 🔒 Allowlist gate — only family numbers are processed.
  if (!isAllowed(msg.from, deps.allowlist)) {
    log("rejected non-allowlisted sender", { from: msg.from });
    await deps.sendText(msg.from, REFUSAL_HE);
    return "refused";
  }

  // 🔑 #229 — resolve the family ONCE, right after the allowlist gate and BEFORE any write/model call. The
  // resolved id threads down on a per-request deps clone (`rdeps`); every downstream site reads it via
  // `familyOf`/the `family` local. This is the cross-tenant chokepoint with NO RLS backstop: an
  // allowlisted-but-UNBOUND phone (resolver wired AND returns null) is a bootstrap/config error → log and
  // SKIP without writing, NEVER fall through to FAMILY_ID="default". No resolver wired (app-only dev / unit
  // tests) ⇒ `familyId` stays unset ⇒ `familyOf` degrades to FAMILY_ID, i.e. the exact prior behavior.
  let rdeps = deps;
  if (deps.familyResolver) {
    const resolved = deps.familyResolver.resolveFamilyByPhone(msg.from);
    if (resolved === null) {
      log("allowlisted sender has no family binding — skipping (no write)", { from: msg.from });
      return "refused";
    }
    rdeps = { ...deps, familyId: resolved };
  }
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

  // G16: per-sender daily ceiling — the allowlist bounds *who* and the input cap (G2) bounds
  // message *size*; this bounds *rate*, the last unbounded cost axis vs ≤$100/mo. Checked here
  // (after the allowlist so non-family senders are never counted, before any model call). The
  // message is already enqueued (persist-before-ack), so the count includes it; resets at
  // Jerusalem midnight. Off unless both the ceiling and the inbound counter are wired.
  if (deps.maxPerSenderPerDay !== undefined && deps.inbound) {
    const since = jerusalemDayStartSqlite(now);
    const count = deps.inbound.countFromSenderSince(msg.from, since);
    if (count > deps.maxPerSenderPerDay) {
      // G23: a resume-answer is NOT a new intent. If the sender has a LIVE open thread (the `pending`
      // looked up above), exempt them from the ceiling so their answer still resolves/expires the thread
      // — otherwise a rate-limited reply would strand it until TTL (clarify #84 / disambiguation #85-86
      // never closes). An already-expired thread is `null` here (swept above + read-time TTL), so it does
      // NOT grant the exemption: that sender is sending something genuinely new and stays rate-limited.
      if (pending == null) {
        log("per-sender daily ceiling hit", {
          from: msg.from,
          count,
          max: deps.maxPerSenderPerDay,
        });
        await deps.sendText(msg.from, RATE_LIMIT_HE);
        return "rate_limited";
      }
      log("ceiling hit but sender has an open thread — exempting the resume (G23)", {
        from: msg.from,
        count,
      });
    }
  }

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

  // #83 RESUME branch (Milestone #8) — ORDER IS LOAD-BEARING (G22): the ROUTING sits AFTER the allowlist
  // + G16 rate gate + text-only guard and BEFORE ביטול / any agent.run. When the sender has an open
  // thread (`pending`, swept + looked up once above), their next message is an ANSWER → route it to the
  // deterministic resume, never re-parse it as a fresh forward (G17). `pending` is non-null ⇒
  // `deps.conversations` is set, so the `?.` calls below always run.
  if (pending) {
    // Bare "ביטול" is the universal escape hatch: it ABORTS the open thread (resolve, NO undo) — the
    // open op takes precedence over the last-message undo (§2).
    if (text === CANCEL_TRIGGER) {
      deps.conversations?.resolve(pending.id);
      log("aborted open thread via ביטול", { from: msg.from, id: pending.id });
      await deps.sendText(msg.from, ABORT_THREAD_HE);
      return "aborted";
    }
    // #86 CORRECTION: a terse "לא ב-/בשעה/במיקום …" corrects the held draft IN PLACE (G21).
    if (CORRECTION_RE.test(text)) {
      await applyCorrection(rdeps, msg, pending, today);
      return "edited";
    }
    // #207 — a fresh VERB-LED command (cancel/edit) takes precedence over the open thread: abort it and
    // let the deterministic routes below handle the command, exactly as bare ביטול aborts (above).
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
      deps.conversations?.resolve(pending.id);
      log(
        isVerbLedCommand
          ? "verb-led command overrides open thread → route as command"
          : "non-correction 'לא' with a schedule signal → new forward",
        { from: msg.from },
      );
    } else {
      await handleResume(rdeps, msg, pending);
      return "resumed";
    }
  }

  // Undo: a bare "ביטול" removes the sender's last message's events — caught before parse so it's
  // never sent to Claude. The confirm (with the resolved Hebrew date) is what makes a misparse
  // catchable; this is the recovery. #229: scoped by SENDER phone (not the resolved family) — a phone
  // belongs to exactly one family, so this is already family-isolated; it leans on the same
  // one-phone-one-family invariant the resolver does, not on the threaded `family`.
  if (text === CANCEL_TRIGGER) {
    const removed = deps.events.deleteLastFromSender(msg.from);
    log("cancel", { from: msg.from, removed });
    await deps.sendText(msg.from, cancelReply(removed));
    return "cancelled";
  }

  // Gmail sync (#72): a bare "סנכרן מייל" pulls the family's recent matching emails onto the board.
  // Deterministic route (sibling to ביטול) → an agent run that forces `read_gmail` on turn 0 (keeps
  // G4). Opt-in: with no Google bundle or no stored credential we reply "connect first" and make ZERO
  // Gmail/parse/model calls. The command already counted against the G16 ceiling above.
  if (text === SYNC_MAIL_TRIGGER) {
    if (!deps.google?.credentials.get(family)) {
      log("sync mail — not connected", { from: msg.from });
      await deps.sendText(msg.from, NOT_CONNECTED_HE);
      return;
    }
    await runSyncIntent(deps, msg, SYNC_INTENT, "read_gmail", SYNC_NONE_HE, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: family,
      events: deps.events,
      google: deps.google, // the G8 gate — read_gmail is inert unless this is set (sync path only)
    });
    return "synced";
  }

  // Calendar sync (#18): a bare "סנכרן יומן" pulls the family's upcoming Google Calendar events onto the
  // board. Same shape as the mail sync — deterministic route (sibling to ביטול), forces `read_calendar`
  // on turn 0 (keeps G4), opt-in: no Google bundle / no stored credential ⇒ "connect first", ZERO calls.
  if (text === SYNC_CAL_TRIGGER) {
    if (!deps.calendar?.credentials.get(family)) {
      log("sync calendar — not connected", { from: msg.from });
      await deps.sendText(msg.from, CAL_NOT_CONNECTED_HE);
      return;
    }
    await runSyncIntent(deps, msg, SYNC_CAL_INTENT, "read_calendar", SYNC_CAL_NONE_HE, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: family,
      events: deps.events,
      calendar: deps.calendar, // the G8 gate — read_calendar is inert unless this is set (sync path only)
    });
    return "synced";
  }

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

  // Slot-dedup sink (opt-in): the extract tool pushes an existing board row here instead of re-adding a
  // forward whose (date, time) slot is already taken, so a re-send isn't duplicated on the board.
  const duplicates: SavedEvent[] = [];
  let result: AgentResult;
  try {
    // The agent decides parse-vs-act, runs a tool, and the TOOL persists its own rows (#71) — the
    // handler no longer saves. Anchor + sender + familyId + the events store are server-supplied via
    // ToolContext (G8); senderName (from the members map) drives first-person → assignee (#14).
    result = await deps.agent.run(text, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: family,
      events: deps.events,
      duplicates,
    });
  } catch (err) {
    if (err instanceof TransientError) {
      // The provider hiccuped — tell the user to retry (NOT "rephrase") and rethrow so the
      // inbound row stays `pending` for boot-replay rather than being lost or marked failed.
      log("transient parse error", { id: msg.id });
      await deps.sendText(msg.from, TRANSIENT_HE);
    }
    throw err;
  }

  // #84: the parse flagged a required-slot guess → ask ONE templated question + open a thread; save
  // NOTHING, no confirm. The next message resumes via the #83 RESUME branch above.
  const clarify = clarifyOf(result);
  if (clarify) {
    await openClarifyThread(deps, msg, clarify);
    return "clarified";
  }

  const saved = savedOf(result) ?? [];
  if (saved.length === 0 && duplicates.length === 0) {
    log("unparseable message", { id: msg.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return "rephrase";
  }

  // Slot dedup: a forward that ONLY duplicated existing slot(s) — nothing new saved — gets "already on
  // the board" (not a rephrase), so the user knows it's there and no second copy was made. It WAS a
  // parseable event (just already present), so the feed records it as `parsed`.
  if (saved.length === 0) {
    log("duplicate slot", { id: msg.id, count: duplicates.length });
    await deps.sendText(msg.from, formatAlready(duplicates));
    return "parsed";
  }

  // The tool already persisted each NEW event (idempotent on (wa_message_id, seq)); the handler is now
  // thin — confirm the new rows, and note any duplicates in the same message so nothing seems lost.
  log("saved events", { id: msg.id, count: saved.length, duplicates: duplicates.length });
  const confirm = formatConfirm(saved);
  await deps.sendText(
    msg.from,
    duplicates.length > 0 ? `${confirm}\n\n${formatAlready(duplicates)}` : confirm,
  );

  // #18 chunk 2: auto-push the new board events to Google Calendar — best-effort, AFTER the confirm.
  // The board is the source of truth; a push failure is logged, never fails the confirm or replays the
  // row. App-only / disabled ⇒ no-op; only board-originated rows are written (the push filters them).
  if (deps.autoPushCalendar && deps.calendar) {
    const { pushed } = await pushSavedEventsToCalendar(saved, deps.calendar, family, log);
    if (pushed > 0) log("auto-pushed to calendar", { id: msg.id, pushed });
  }

  return "parsed";
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
