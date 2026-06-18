import type { ParsedEvent } from "@homeos/shared";
import type { EventStore, SavedEvent } from "../db/event-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import { FAMILY_ID } from "../db/schema.ts";
import type { InboundMessage } from "../http/webhook.ts";
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

  // Undo: a bare "ביטול" removes the sender's last message's events — caught before parse so it's
  // never sent to Claude. The confirm (with the resolved Hebrew date) is what makes a misparse
  // catchable; this is the recovery.
  if (text === CANCEL_TRIGGER) {
    const removed = deps.events.deleteLastFromSender(msg.from);
    log("cancel", { from: msg.from, removed });
    await deps.sendText(msg.from, cancelReply(removed));
    return;
  }

  // G2: input-length cap — short-circuit before the model ever sees an oversized payload.
  if (text.length > MAX_INPUT) {
    log("input over MAX_INPUT — rephrase", { id: msg.id, len: text.length });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }

  const today = jerusalemToday((deps.now ?? (() => new Date()))());
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
