import type { ParsedEvent } from "@homeos/shared";
import type { EventStore, SavedEvent } from "../db/event-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import { FAMILY_ID } from "../db/schema.ts";
import type { InboundMessage } from "../http/webhook.ts";
import {
  type CalendarToolDeps,
  type GmailToolDeps,
  pushSavedEventsToCalendar,
  type ToolContext,
} from "../tools/tools.ts";
import type { SendText } from "../whatsapp/client.ts";
import type { Agent } from "./agent.ts";
import { isAllowed } from "./allowlist.ts";
import { TransientError } from "./errors.ts";
import { jerusalemDayStartSqlite } from "./time.ts";

export interface HandlerDeps {
  allowlist: readonly string[];
  agent: Agent;
  events: EventStore;
  sendText: SendText;
  /** Optional phone→family-member-name map; resolves the sender for first-person → assignee (#14). */
  members?: Record<string, string>;
  /**
   * G16 — per-sender daily message ceiling (Asia/Jerusalem day). Unset → no limit. Enforced only
   * when both this and `inbound` (the counter) are wired, so unit tests stay off by default.
   */
  maxPerSenderPerDay?: number;
  /** Inbound queue — also the per-sender daily counter for G16. Required by `ProcessDeps`; optional here. */
  inbound?: InboundStore;
  /** Gmail tool deps (#72) — present only when the GOOGLE_* bundle is configured. Drives the `סנכרן מייל` sync. */
  google?: GmailToolDeps;
  /** Calendar tool deps (#18) — present only when the GOOGLE_* bundle is configured. Drives the `סנכרן יומן` sync. */
  calendar?: CalendarToolDeps;
  /** #18 chunk 2: auto-push forwarded board events to Google Calendar. Off (or no `calendar`) ⇒ read-only. */
  autoPushCalendar?: boolean;
  /** Injectable clock (default: now) so date anchoring is testable. */
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ProcessDeps extends HandlerDeps {
  inbound: InboundStore;
}

const REFUSAL_HE = "מצטערים, אין לך הרשאה להשתמש בשירות הזה.";
const TEXT_ONLY_HE = "כרגע אני מבין רק הודעות טקסט 🙏 (תמיכה בהודעות קוליות בקרוב).";
const REPHRASE_HE = "לא הצלחתי להבין את ההודעה 🤔 אפשר לנסח מחדש?";
const TRANSIENT_HE = "אירעה תקלה זמנית 🙏 נסו שוב בעוד רגע.";
const CANCEL_NONE_HE = "אין מה לבטל 🤷";
/** G16: quiet reply when a sender passes the daily message ceiling — no model call is made. */
const RATE_LIMIT_HE = "הגעת למכסת ההודעות היומית 🙏 נמשיך מחר.";
/** One-word undo: deletes the events from the sender's last message so a misparse is recoverable. */
const CANCEL_TRIGGER = "ביטול";
/** Deterministic Gmail-sync command (#72) — sibling to ביטול; forces `read_gmail` on turn 0 (keeps G4). */
const SYNC_MAIL_TRIGGER = "סנכרן מייל";
/** The trusted internal intent handed to the agent for the sync (NOT untrusted forwarded text). */
const SYNC_INTENT = "Sync the family's recent matching emails into the board.";
const NOT_CONNECTED_HE = "חשבון Google לא מחובר 🔌 כדי לסנכרן מייל צריך קודם לחבר את החשבון.";
const SYNC_NONE_HE = "לא נמצאו אירועים חדשים במייל 📭";
/** Deterministic Calendar-sync command (#18) — sibling to סנכרן מייל; forces `read_calendar` on turn 0 (keeps G4). */
const SYNC_CAL_TRIGGER = "סנכרן יומן";
/** The trusted internal intent handed to the agent for the calendar sync (NOT untrusted forwarded text). */
const SYNC_CAL_INTENT = "Sync the family's upcoming Google Calendar events into the board.";
const CAL_NOT_CONNECTED_HE = "חשבון Google לא מחובר 🔌 כדי לסנכרן יומן צריך קודם לחבר את החשבון.";
const SYNC_CAL_NONE_HE = "לא נמצאו אירועים חדשים ביומן 📭";
/** A permanent Gmail failure (e.g. a 4xx on a revoked/scope-changed token) — the explicit סנכרן מייל command deserves a reply, not silence. */
const SYNC_FAILED_HE = "הסנכרון נכשל 🙁 נסו שוב מאוחר יותר.";
/**
 * G2 — cap input length BEFORE any model call. A 50–100KB forward (long newsletters / pasted PDFs)
 * must never be sent to Claude (~2× per message once the agent loop lands). The allowlist bounds
 * *who*, not message *size*; this is the cost/DoS ceiling on a single message.
 */
const MAX_INPUT = 4000;

function cancelReply(count: number): string {
  if (count === 0) return CANCEL_NONE_HE;
  return count === 1 ? "בוטל ✓" : `בוטלו ${count} פריטים ✓`;
}

/** YYYY-MM-DD for "now" in Asia/Jerusalem (en-CA renders ISO; handles DST). */
function jerusalemToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

const hebrewDate = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * The confirm is the product's most-seen surface in a Hebrew family product, so render the
 * resolved date in Hebrew ("יום ראשון, 21 ביוני · 18:30"), not robotic ISO. Anchoring the Date
 * at UTC noon keeps the calendar day stable across the Asia/Jerusalem offset. Appends the
 * assignee and a weekly-recurrence marker when present.
 */
function formatWhen(event: ParsedEvent): string {
  const dateHe = hebrewDate.format(new Date(`${event.date_iso}T12:00:00Z`));
  const parts = [event.time ? `${dateHe} · ${event.time}` : dateHe];
  if (event.recurrence) parts.push("(שבועי)");
  if (event.assignee) parts.push(`— ${event.assignee}`);
  return parts.join(" ");
}

/** One message can yield several events; confirm a single item inline, or list a count + bullets. */
function formatConfirm(events: SavedEvent[]): string {
  if (events.length === 1) {
    const e = events[0]!;
    return `הוספתי ליומן ✓\n${e.title_he} · ${formatWhen(e)}`;
  }
  const lines = events.map((e) => `• ${e.title_he} · ${formatWhen(e)}`).join("\n");
  return `הוספתי ${events.length} פריטים ליומן ✓\n${lines}`;
}

/**
 * Shared provider-sync run (Gmail #72 / Calendar #18): force the given tool on an agent run (turn 0,
 * G4), then confirm the saved rows, reply "nothing new", or — on error — tell the user (transient →
 * "try again", permanent → "failed") and rethrow so the inbound row settles correctly (pending vs
 * failed). The provider seam (`google`/`calendar`) is already wired into `ctx` — the G8 capability gate.
 */
async function runSyncIntent(
  deps: HandlerDeps,
  msg: InboundMessage,
  intent: string,
  forceTool: string,
  noneReply: string,
  ctx: ToolContext,
): Promise<void> {
  const log = deps.log ?? (() => {});
  let synced: SavedEvent[] | null;
  try {
    synced = await deps.agent.run(intent, ctx, { forceTool });
  } catch (err) {
    if (err instanceof TransientError) {
      // A provider blip (429/5xx/network) → "try again" and rethrow so the row stays pending for replay.
      log("transient provider sync", { id: msg.id, tool: forceTool });
      await deps.sendText(msg.from, TRANSIENT_HE);
    } else {
      // A permanent failure (e.g. a 4xx on a token rejected mid-run) — acknowledge the user's explicit
      // command instead of leaving them in silence, then rethrow so the row settles as failed (G10).
      log("provider sync failed (permanent)", { id: msg.id, tool: forceTool, error: String(err) });
      await deps.sendText(msg.from, SYNC_FAILED_HE);
    }
    throw err;
  }
  if (!synced || synced.length === 0) {
    await deps.sendText(msg.from, noneReply);
    return;
  }
  log("synced provider events", { from: msg.from, tool: forceTool, count: synced.length });
  await deps.sendText(msg.from, formatConfirm(synced));
}

/**
 * M2 inbound handling: allowlist gate → parse (Claude) → persist → Hebrew confirm.
 * Voice/media is deferred to M2b, so non-text messages get a friendly "text only" reply.
 * Dedupe + durability now live in the inbound queue (the message is persisted before the
 * ack and de-duped on wa_message_id); `processInbound` wraps this and settles the row.
 */
export async function handleInbound(msg: InboundMessage, deps: HandlerDeps): Promise<void> {
  const log = deps.log ?? (() => {});

  // 🔒 Allowlist gate — only family numbers are processed.
  if (!isAllowed(msg.from, deps.allowlist)) {
    log("rejected non-allowlisted sender", { from: msg.from });
    await deps.sendText(msg.from, REFUSAL_HE);
    return;
  }

  // G16: per-sender daily ceiling — the allowlist bounds *who* and the input cap (G2) bounds
  // message *size*; this bounds *rate*, the last unbounded cost axis vs ≤$100/mo. Checked here
  // (after the allowlist so non-family senders are never counted, before any model call). The
  // message is already enqueued (persist-before-ack), so the count includes it; resets at
  // Jerusalem midnight. Off unless both the ceiling and the inbound counter are wired.
  if (deps.maxPerSenderPerDay !== undefined && deps.inbound) {
    const since = jerusalemDayStartSqlite((deps.now ?? (() => new Date()))());
    const count = deps.inbound.countFromSenderSince(msg.from, since);
    if (count > deps.maxPerSenderPerDay) {
      log("per-sender daily ceiling hit", { from: msg.from, count, max: deps.maxPerSenderPerDay });
      await deps.sendText(msg.from, RATE_LIMIT_HE);
      return;
    }
  }

  // M2a is text-only; voice/images land in M2b.
  const text = msg.text?.trim();
  if (!text) {
    await deps.sendText(msg.from, TEXT_ONLY_HE);
    return;
  }

  const today = jerusalemToday((deps.now ?? (() => new Date()))());

  // Undo: a bare "ביטול" removes the sender's last message's events — caught before parse so it's
  // never sent to Claude. The confirm (with the resolved Hebrew date) is what makes a misparse
  // catchable; this is the recovery.
  if (text === CANCEL_TRIGGER) {
    const removed = deps.events.deleteLastFromSender(msg.from);
    log("cancel", { from: msg.from, removed });
    await deps.sendText(msg.from, cancelReply(removed));
    return;
  }

  // Gmail sync (#72): a bare "סנכרן מייל" pulls the family's recent matching emails onto the board.
  // Deterministic route (sibling to ביטול) → an agent run that forces `read_gmail` on turn 0 (keeps
  // G4). Opt-in: with no Google bundle or no stored credential we reply "connect first" and make ZERO
  // Gmail/parse/model calls. The command already counted against the G16 ceiling above.
  if (text === SYNC_MAIL_TRIGGER) {
    if (!deps.google?.credentials.get(FAMILY_ID)) {
      log("sync mail — not connected", { from: msg.from });
      await deps.sendText(msg.from, NOT_CONNECTED_HE);
      return;
    }
    await runSyncIntent(deps, msg, SYNC_INTENT, "read_gmail", SYNC_NONE_HE, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: FAMILY_ID,
      events: deps.events,
      google: deps.google, // the G8 gate — read_gmail is inert unless this is set (sync path only)
    });
    return;
  }

  // Calendar sync (#18): a bare "סנכרן יומן" pulls the family's upcoming Google Calendar events onto the
  // board. Same shape as the mail sync — deterministic route (sibling to ביטול), forces `read_calendar`
  // on turn 0 (keeps G4), opt-in: no Google bundle / no stored credential ⇒ "connect first", ZERO calls.
  if (text === SYNC_CAL_TRIGGER) {
    if (!deps.calendar?.credentials.get(FAMILY_ID)) {
      log("sync calendar — not connected", { from: msg.from });
      await deps.sendText(msg.from, CAL_NOT_CONNECTED_HE);
      return;
    }
    await runSyncIntent(deps, msg, SYNC_CAL_INTENT, "read_calendar", SYNC_CAL_NONE_HE, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: FAMILY_ID,
      events: deps.events,
      calendar: deps.calendar, // the G8 gate — read_calendar is inert unless this is set (sync path only)
    });
    return;
  }

  // G2: input-length cap — short-circuit before the model ever sees an oversized payload.
  if (text.length > MAX_INPUT) {
    log("input over MAX_INPUT — rephrase", { id: msg.id, len: text.length });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }

  let saved: SavedEvent[] | null;
  try {
    // The agent decides parse-vs-act, runs a tool, and the TOOL persists its own rows (#71) — the
    // handler no longer saves. Anchor + sender + familyId + the events store are server-supplied via
    // ToolContext (G8); senderName (from the members map) drives first-person → assignee (#14).
    saved = await deps.agent.run(text, {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: FAMILY_ID,
      events: deps.events,
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
  if (!saved || saved.length === 0) {
    log("unparseable message", { id: msg.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }

  // The tool already persisted each event (idempotent on (wa_message_id, seq)); the handler is now
  // thin — just send one Hebrew confirm covering all of them.
  log("saved events", { id: msg.id, count: saved.length });
  await deps.sendText(msg.from, formatConfirm(saved));

  // #18 chunk 2: auto-push the new board events to Google Calendar — best-effort, AFTER the confirm.
  // The board is the source of truth; a push failure is logged, never fails the confirm or replays the
  // row. App-only / disabled ⇒ no-op; only board-originated rows are written (the push filters them).
  if (deps.autoPushCalendar && deps.calendar) {
    const { pushed } = await pushSavedEventsToCalendar(saved, deps.calendar, FAMILY_ID, log);
    if (pushed > 0) log("auto-pushed to calendar", { id: msg.id, pushed });
  }
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
    await handleInbound(msg, deps);
    deps.inbound.markDone(msg.id);
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
