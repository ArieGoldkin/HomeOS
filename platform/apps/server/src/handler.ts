import type { ParsedEvent } from "@homeos/shared";
import { isAllowed } from "./allowlist.ts";
import type { EventStore } from "./db.ts";
import type { IdempotencyStore } from "./idempotency.ts";
import type { ParseMessage } from "./parse.ts";
import type { InboundMessage } from "./webhook.ts";
import type { SendText } from "./whatsapp.ts";

export interface HandlerDeps {
  allowlist: readonly string[];
  store: IdempotencyStore;
  parse: ParseMessage;
  events: EventStore;
  sendText: SendText;
  /** Injectable clock (default: now) so date anchoring is testable. */
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

const REFUSAL_HE = "מצטערים, אין לך הרשאה להשתמש בשירות הזה.";
const TEXT_ONLY_HE = "כרגע אני מבין רק הודעות טקסט 🙏 (תמיכה בהודעות קוליות בקרוב).";
const REPHRASE_HE = "לא הצלחתי להבין את ההודעה 🤔 אפשר לנסח מחדש?";

/** YYYY-MM-DD for "now" in Asia/Jerusalem (en-CA renders ISO; handles DST). */
function jerusalemToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

function formatConfirm(event: ParsedEvent): string {
  const when = event.time ? `${event.date_iso} ${event.time}` : event.date_iso;
  return `הוספתי ליומן ✓\n${event.title_he} · ${when}`;
}

/**
 * M2 inbound handling: dedupe → allowlist gate → parse (Claude) → persist → Hebrew confirm.
 * Voice/media is deferred to M2b, so non-text messages get a friendly "text only" reply.
 * The allowlist + idempotency guardrails are unchanged from M1.
 */
export async function handleInbound(msg: InboundMessage, deps: HandlerDeps): Promise<void> {
  const log = deps.log ?? (() => {});

  // ⚡ Dedupe first — Meta retries; act at most once per wa_message_id.
  if (deps.store.seen(msg.id)) {
    log("skipped duplicate message", { id: msg.id });
    return;
  }

  // 🔒 Allowlist gate — only family numbers are processed.
  if (!isAllowed(msg.from, deps.allowlist)) {
    log("rejected non-allowlisted sender", { from: msg.from });
    await deps.sendText(msg.from, REFUSAL_HE);
    return;
  }

  // M2a is text-only; voice/images land in M2b.
  const text = msg.text?.trim();
  if (!text) {
    await deps.sendText(msg.from, TEXT_ONLY_HE);
    return;
  }

  const today = jerusalemToday((deps.now ?? (() => new Date()))());
  const parsed = await deps.parse(text, today);
  if (!parsed) {
    log("unparseable message", { id: msg.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }

  const saved = deps.events.saveEvent(parsed, { fromPhone: msg.from, waMessageId: msg.id });
  log("saved event", { id: saved.id, kind: saved.kind, date: saved.date_iso });
  await deps.sendText(msg.from, formatConfirm(saved));
}
