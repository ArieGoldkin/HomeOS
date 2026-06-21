import type { ClarifyReason, ParsedEvent } from "@homeos/shared";
import type { ConversationStore } from "../../db/conversation-store.ts";
import type { EventStore, SavedEvent } from "../../db/event-store.ts";
import type { InboundStore } from "../../db/inbound-store.ts";
import type { ParseMessage } from "../../parsing/parser.ts";
import type { CalendarToolDeps, ClarifyResult, GmailToolDeps } from "../../tools/tools.ts";
import type { SendText } from "../../whatsapp/client.ts";
import type { Agent, AgentResult } from "../agent.ts";

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
  /**
   * #83 (Milestone #8) — bounded-conversation store. When wired, an open thread routes the sender's
   * next message to the deterministic RESUME branch (clarify/cancel/edit) instead of `agent.run`.
   * Optional so the branch is fully additive: unset ⇒ the handler behaves exactly as before.
   */
  conversations?: ConversationStore;
  /**
   * #84 — the non-persisting parse seam, used by a clarify RESUME to re-resolve a free-form Hebrew date
   * answer ("ביום ראשון בשמונה") into the held draft WITHOUT saving (a single structured call, never an
   * auto agent turn — G17). Optional: a `missing_date` resume degrades to REPHRASE when it's unwired.
   */
  parse?: ParseMessage;
  /** Injectable clock (default: now) so date anchoring is testable. */
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ProcessDeps extends HandlerDeps {
  inbound: InboundStore;
}

export const REFUSAL_HE = "מצטערים, אין לך הרשאה להשתמש בשירות הזה.";
export const TEXT_ONLY_HE = "כרגע אני מבין רק הודעות טקסט 🙏 (תמיכה בהודעות קוליות בקרוב).";
export const REPHRASE_HE = "לא הצלחתי להבין את ההודעה 🤔 אפשר לנסח מחדש?";
/** Slot dedup — a forward landed on a (date, time) slot already on the board: no second copy is made. */
export const ALREADY_HE = "כבר ביומן ✓";
export const TRANSIENT_HE = "אירעה תקלה זמנית 🙏 נסו שוב בעוד רגע.";
export const CANCEL_NONE_HE = "אין מה לבטל 🤷";
/** G16: quiet reply when a sender passes the daily message ceiling — no model call is made. */
export const RATE_LIMIT_HE = "הגעת למכסת ההודעות היומית 🙏 נמשיך מחר.";
/** One-word undo: deletes the events from the sender's last message so a misparse is recoverable. */
export const CANCEL_TRIGGER = "ביטול";
/** Deterministic Gmail-sync command (#72) — sibling to ביטול; forces `read_gmail` on turn 0 (keeps G4). */
export const SYNC_MAIL_TRIGGER = "סנכרן מייל";
/** The trusted internal intent handed to the agent for the sync (NOT untrusted forwarded text). */
export const SYNC_INTENT = "Sync the family's recent matching emails into the board.";
export const NOT_CONNECTED_HE =
  "חשבון Google לא מחובר 🔌 כדי לסנכרן מייל צריך קודם לחבר את החשבון.";
export const SYNC_NONE_HE = "לא נמצאו אירועים חדשים במייל 📭";
/** Deterministic Calendar-sync command (#18) — sibling to סנכרן מייל; forces `read_calendar` on turn 0 (keeps G4). */
export const SYNC_CAL_TRIGGER = "סנכרן יומן";
/** The trusted internal intent handed to the agent for the calendar sync (NOT untrusted forwarded text). */
export const SYNC_CAL_INTENT = "Sync the family's upcoming Google Calendar events into the board.";
export const CAL_NOT_CONNECTED_HE =
  "חשבון Google לא מחובר 🔌 כדי לסנכרן יומן צריך קודם לחבר את החשבון.";
export const SYNC_CAL_NONE_HE = "לא נמצאו אירועים חדשים ביומן 📭";
/** A permanent Gmail failure (e.g. a 4xx on a revoked/scope-changed token) — the explicit סנכרן מייל command deserves a reply, not silence. */
export const SYNC_FAILED_HE = "הסנכרון נכשל 🙁 נסו שוב מאוחר יותר.";
/**
 * #84 — SERVER-OWNED Hebrew clarify templates. The model NEVER composes the question (Meta 2026
 * single-purpose red line): it only emits a constrained reason enum; the handler picks the template.
 * `Partial` + a `REPHRASE_HE` fallback honours "no template → rephrase". Only the required-slot reasons
 * the gate can emit are present; `missing_time` is intentionally absent (it never opens a thread).
 */
export const CLARIFY_QUESTIONS: Partial<Record<ClarifyReason, string>> = {
  missing_date: "לא הבנתי מתי זה — לאיזה תאריך לקבוע? 🗓️",
  ambiguous_title: "מה לרשום ככותרת? 🤔",
};
/** Open-thread TTL (#84/G24): a clarify question expires after 30 min so a stale "מתי זה?" never resumes. */
export const CONVERSATION_TTL_MS = 30 * 60 * 1000;
/**
 * #85 cancel-BY-REFERENCE (distinct from bare ביטול): a deterministic verb-prefix route — "בטל/מחק/הסר
 * <ref>". The `\S+` requires a referent so a bare "ביטול" still hits the undo branch. The reference is
 * extracted SERVER-side (no model call); the family lookup decides 0/1/N, never the message content.
 */
export const CANCEL_REF_RE = /^(בטל|מחק|הסר)\s+\S+/u;
export const TIME_RE = /(\d{1,2}):(\d{2})/u;
export const CANCEL_NOT_FOUND_HE = "לא מצאתי אירוע כזה 🤷 נסו עם תאריך/שעה מדויקים";
export const CANCEL_WHICH_HE = "איזה מהם לבטל? השב/י במספר:";
/** #85 — bare "ביטול" while a thread is open ABORTS the thread (it never falls through to the undo). */
export const ABORT_THREAD_HE = "בסדר, ביטלתי 👍";
/**
 * #86 edit-in-place: explicit "שנה/ערוך/תקן/עדכן <ref> <delta>" (deterministic, NO model call). The
 * CORRECTION variant ("לא ב-28, ב-21") fires only INSIDE an open thread (G21). The field delta comes
 * from a FIXED vocabulary (ל-HH:MM/לשעה→time, למיקום/לכתובת→location, ל-DD→day-of-month) — no open domain.
 */
export const EDIT_REF_RE = /^(שנה|ערוך|תקן|עדכן)\s+\S+/u;
export const CORRECTION_RE = /^לא,?\s+(ב-|ה-|בשעה|במיקום)/u;
export const EDIT_TIME_RE = /ל(?:שעה\s*)?-?\s*(\d{1,2}):(\d{2})/u;
// #126/F2 — non-greedy + bounded: the location stops before a following ל-/בשעה time/day token so it
// can't swallow it (e.g. "למיקום בית הספר ל-18:00" → location "בית הספר", time still extracted).
export const EDIT_LOCATION_RE = /ל(?:מיקום|כתובת)\s+(.+?)(?=\s+ל-?\s*\d|\s+בשעה|$)/u;
export const EDIT_DAY_RE = /ל-?(\d{1,2})(?![:\d])/u;
export const EDIT_SYNCED_HE = "אי אפשר לערוך אירוע שמסונכרן מהיומן 🔒";
/**
 * G2 — cap input length BEFORE any model call. A 50–100KB forward (long newsletters / pasted PDFs)
 * must never be sent to Claude (~2× per message once the agent loop lands). The allowlist bounds
 * *who*, not message *size*; this is the cost/DoS ceiling on a single message.
 */
export const MAX_INPUT = 4000;

export function cancelReply(count: number): string {
  if (count === 0) return CANCEL_NONE_HE;
  return count === 1 ? "בוטל ✓" : `בוטלו ${count} פריטים ✓`;
}

/** YYYY-MM-DD for "now" in Asia/Jerusalem (en-CA renders ISO; handles DST). */
export function jerusalemToday(now: Date): string {
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
export function formatWhen(event: ParsedEvent): string {
  const dateHe = hebrewDate.format(new Date(`${event.date_iso}T12:00:00Z`));
  const parts = [event.time ? `${dateHe} · ${event.time}` : dateHe];
  if (event.recurrence) parts.push("(שבועי)");
  if (event.assignee) parts.push(`— ${event.assignee}`);
  return parts.join(" ");
}

/** One message can yield several events; confirm a single item inline, or list a count + bullets. */
export function formatConfirm(events: SavedEvent[]): string {
  if (events.length === 1) {
    const e = events[0]!;
    return `הוספתי ליומן ✓\n${e.title_he} · ${formatWhen(e)}`;
  }
  const lines = events.map((e) => `• ${e.title_he} · ${formatWhen(e)}`).join("\n");
  return `הוספתי ${events.length} פריטים ליומן ✓\n${lines}`;
}

/** Slot dedup — the "already on the board" reply, listing the existing slot(s) so the user knows the
 *  meeting is there and no second copy was made. Mirrors `formatConfirm`'s single-vs-list shape. */
export function formatAlready(events: SavedEvent[]): string {
  if (events.length === 1) {
    const e = events[0]!;
    return `${ALREADY_HE}\n${e.title_he} · ${formatWhen(e)}`;
  }
  const lines = events.map((e) => `• ${e.title_he} · ${formatWhen(e)}`).join("\n");
  return `${ALREADY_HE}\n${lines}`;
}

/** JSON.parse that returns null instead of throwing on a corrupt blob (paired with clarifyPayloadSchema). */
export function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 0=Sunday … 6=Saturday — the Israeli week. Matched with or without a "ביום"/"יום" prefix. */
export const HEBREW_WEEKDAYS: Record<string, number> = {
  ראשון: 0,
  שני: 1,
  שלישי: 2,
  רביעי: 3,
  חמישי: 4,
  שישי: 5,
  שבת: 6,
};
// JS `\b` is ASCII-only and does NOT work around Hebrew letters, so word edges use Unicode
// letter-lookarounds (`\p{L}`) instead. A weekday may carry a "ביום"/"יום" prefix.
export const WEEKDAY_RE = /(?<!\p{L})(?:ב?יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?!\p{L})/u;

/** `todayIso` (YYYY-MM-DD) + N days via date-only UTC math (no TZ drift for a calendar-day add). */
export function addDaysIso(iso: string, days: number): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
export function weekdayOfIso(iso: string): number {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** #86 — does the text carry a date/time signal (weekday / relative-date / HH:MM / D.M)? A "לא …" that
 *  isn't a field correction but DOES carry one is a real new forward, not a thread non-answer. */
export function hasScheduleSignal(text: string): boolean {
  return (
    WEEKDAY_RE.test(text) ||
    /(?<!\p{L})(?:היום|מחר|מחרתיים)(?!\p{L})/u.test(text) ||
    TIME_RE.test(text) ||
    /\d{1,2}[./]\d{1,2}/u.test(text)
  );
}

/** #84: narrow the agent's 3-arm result. `clarify` → the request to ask; otherwise saved rows (or null). */
export function clarifyOf(r: AgentResult): ClarifyResult | null {
  return r && "clarify" in r ? r.clarify : null;
}
export function savedOf(r: AgentResult): SavedEvent[] | null {
  return r && "clarify" in r ? null : r;
}
