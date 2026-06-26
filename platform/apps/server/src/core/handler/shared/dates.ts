import { sqliteUtc } from "../../time.ts";
import type { HandlerDeps } from "./deps.ts";
import { TIME_RE } from "./patterns.ts";

/**
 * Open-thread TTL (#84/G24): a clarify question expires after 30 min so a stale "מתי זה?" never resumes.
 * Product call (#87): 30 min, not 10 — a forwarded-message round-trip in a busy family chat can sit
 * unanswered through a school pickup or a meeting; 10 min would expire mid-conversation and force a
 * re-forward, while 30 min still bounds the held forwarded-text draft tightly for privacy/retention.
 * This is the DEFAULT; `HandlerDeps.conversationTtlMs` (env `CONVERSATION_TTL_MIN`) overrides it, and a
 * test sets `0` to force immediate expiry.
 */
export const CONVERSATION_TTL_MS = 30 * 60 * 1000;
/**
 * #87 — the SINGLE application site for the open-thread TTL: `now + (injected ?? default)` rendered as a
 * SQLite-UTC string, ready for `ConversationStore.create`. The clarify/cancel/edit writers all call this,
 * so a future change to the formula (clamping, per-kind TTL) lives in one place — matching the
 * `conversationTtlMs` contract ("the one place the duration lives").
 */
export function conversationExpiresAt(
  deps: Pick<HandlerDeps, "now" | "conversationTtlMs">,
): string {
  const ms =
    (deps.now ?? (() => new Date()))().getTime() + (deps.conversationTtlMs ?? CONVERSATION_TTL_MS);
  return sqliteUtc(new Date(ms));
}

/** YYYY-MM-DD for "now" in Asia/Jerusalem (en-CA renders ISO; handles DST). */
export function jerusalemToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
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
