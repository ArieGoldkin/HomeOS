import type { ClarifyReason, ParsedEvent } from "@homeos/shared";
import type { ConversationStore } from "../../db/conversation-store.ts";
import type { EventStore, SavedEvent } from "../../db/event-store.ts";
import type { InboundStore } from "../../db/inbound-store.ts";
import { FAMILY_ID } from "../../db/schema.ts";
import type { InboundMessage } from "../../http/webhook.ts";
import type { ParseMessage } from "../../parsing/parser.ts";
import type { CalendarToolDeps, ClarifyResult, GmailToolDeps } from "../../tools/tools.ts";
import type { SendText } from "../../whatsapp/client.ts";
import type { Agent, AgentResult } from "../agent.ts";
import { sqliteUtc } from "../time.ts";

export interface HandlerDeps {
  allowlist: readonly string[];
  agent: Agent;
  /**
   * #147 — the bounded RESOLVE agent for the agentic cancel/edit fallback. Registered with ONLY
   * `search_events` (NOT `extract_events`), so a cancel routed here can never create an event (AC#3).
   * Optional: unwired ⇒ a deterministic 0-match just replies not-found, exactly as before (fully additive).
   */
  resolveAgent?: Agent;
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
   * #87/G24 — open-thread TTL in ms, injected so it's a single configured constant (not a magic number
   * scattered across the clarify/cancel/edit writers) and so a test can force expiry with `0`. Unset ⇒
   * `CONVERSATION_TTL_MS` (30 min). The store stays clock-agnostic (it takes a pre-computed `expiresAt`);
   * this is the one place the duration lives, read at thread-CREATE time by every writer.
   */
  conversationTtlMs?: number;
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
/**
 * #85 cancel-BY-REFERENCE (distinct from bare ביטול): a deterministic verb-prefix route — "בטל/מחק/הסר
 * <ref>". The `\S+` requires a referent so a bare "ביטול" still hits the undo branch. The reference is
 * extracted SERVER-side (no model call); the family lookup decides 0/1/N, never the message content.
 *
 * The verb set covers the common Hebrew inflections a real user types — bare imperative (בטל/מחק/הסר),
 * the ת-imperative (תבטל/תמחק/תסיר) and the infinitive (לבטל/למחוק/להסיר) — because a live miss
 * ("טוב בטל…") got parsed as a NEW event instead of a cancel. `CANCEL_VERB_STRIP_RE` removes whichever
 * form led the command so `extractCancelRef` doesn't leak the verb into the title hint. Leading filler
 * ("טוב"/"אוקיי"…) is stripped first by `stripLeadingFiller` (the route still requires a verb at the
 * start AND a real board match, so a forward that merely contains these words deletes nothing — G22).
 */
const CANCEL_VERBS = "בטל|תבטל|לבטל|מחק|תמחק|למחוק|הסר|תסיר|להסיר";
export const CANCEL_REF_RE = new RegExp(`^(?:${CANCEL_VERBS})\\s+\\S+`, "u");
export const CANCEL_VERB_STRIP_RE = new RegExp(`^(?:${CANCEL_VERBS})\\s+`, "u");
/**
 * #163 — a BULK quantifier ("בטל את כל הפגישות מחר"). ANCHORED to the START of the cancel OBJECT (applied
 * after the verb + a leading "את" are stripped) so the quantifier must LEAD the thing being cancelled — a
 * mid-sentence "כל" ("בטל את הפגישה עם כל המשפחה מחר" → cancel THE meeting) is NOT a bulk op and stays on
 * the single-target path. `(?!\p{L})` keeps it a whole word: matches bare "כל ה…", "הכל", "כולם", but
 * never a longer word that merely starts with those letters. A scope (date/time) is still required by the
 * caller, so "בטל הכל" (no scope) never offers a whole-board wipe.
 */
export const BULK_QUANTIFIER_RE = /^(?:כל|הכל|כולם)(?!\p{L})/u;
/**
 * Leading conversational filler a user puts before a command ("טוב בטל…", "אוקיי שנה…"). Stripped only
 * to TEST + drive the deterministic verb-led routes (cancel/edit); the ORIGINAL text is what reaches the
 * model on fall-through, so over-stripping can never corrupt a real forward — at worst a command isn't
 * recognized. Applied repeatedly (capped) so "טוב, אז בטל…" also resolves.
 */
const LEADING_FILLER_RE = /^(?:טוב|אוקיי?|או\.?קיי?|בבקשה|נא|כן|אז|היי|אהלן|יאללה|סבבה)[\s,]+/u;
export function stripLeadingFiller(text: string): string {
  let out = text;
  for (let i = 0; i < 3 && LEADING_FILLER_RE.test(out); i++)
    out = out.replace(LEADING_FILLER_RE, "");
  return out;
}
export const TIME_RE = /(\d{1,2}):(\d{2})/u;
export const CANCEL_NOT_FOUND_HE = "לא מצאתי אירוע כזה 🤷 נסו עם תאריך/שעה מדויקים";
export const CANCEL_WHICH_HE = "איזה מהם לבטל? השב/י במספרים (למשל 1 ו-2, או 'הכל'):";
/** #161 — edit's own disambiguation prompt (לעדכן, not the cancel-specific לבטל); same multi-select invite. */
export const EDIT_WHICH_HE = "איזה מהם לעדכן? השב/י במספרים (למשל 1 ו-2, או 'הכל'):";
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
 * #147 — FAIL-CLOSED affirmative for the confirm-before-destroy gate. ONLY an anchored `כן` executes the
 * agentic 1-match cancel/edit; `לא`, a non-answer, or a timeout all ABORT with no write. `(?!\p{L})` lets
 * "כן" / "כן בבקשה" through but never a longer word that merely starts with those letters — and crucially,
 * anything that ISN'T an affirmative defaults to NO (the safe direction for a destructive op on a shared board).
 */
export const AFFIRM_RE = /^כן(?!\p{L})/u;
/** #147 — the no-write reply when a confirm-before-destroy is declined / unanswered (fail-closed). */
export const CONFIRM_ABORT_HE = "בסדר, השארתי הכול כמו שהיה 👍";
/** #147 — confirm-before-destroy prompt for an agentic 1-match cancel (the model resolved ONE candidate). */
export function cancelConfirmPrompt(e: SavedEvent): string {
  return `לבטל את "${e.title_he}" · ${formatWhen(e)}? השב/י כן לאישור`;
}
/** #147 — confirm-before-destroy prompt for an agentic 1-match edit (the model resolved ONE candidate). */
export function editConfirmPrompt(e: SavedEvent): string {
  return `לעדכן את "${e.title_he}" · ${formatWhen(e)}? השב/י כן לאישור`;
}
/**
 * #163 — confirm-before-destroy prompt for a BULK cancel: list the whole in-scope set so the family SEES
 * exactly what a כן will delete, then ask for a single yes/no (fail-closed via AFFIRM_RE). Bullets (not a
 * numbered list) signal "this is a yes/no over all of them", not a pick-some disambiguation.
 */
export function bulkCancelConfirmPrompt(events: SavedEvent[]): string {
  const list = events.map((e) => `• ${e.title_he} · ${formatWhen(e)}`).join("\n");
  return `לבטל את כל ${events.length} הפריטים הבאים? השב/י כן לאישור\n${list}`;
}
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

/** #84/#147: narrow the agent's arms. `clarify` → the request to ask; `resolved` → cancel/edit candidates
 *  (#147, only the resolve agent returns it); otherwise saved rows (or null). */
export function clarifyOf(r: AgentResult): ClarifyResult | null {
  return r && "clarify" in r ? r.clarify : null;
}
export function savedOf(r: AgentResult): SavedEvent[] | null {
  if (!r || "clarify" in r || "resolved" in r) return null;
  return r;
}
/** #147: narrow the resolve agent's `{resolved}` arm → the matched candidate rows, or null if it's any
 *  other arm. An empty array (found nothing) is a valid `resolved` value the caller treats as not-found. */
export function resolvedOf(r: AgentResult): SavedEvent[] | null {
  return r && "resolved" in r ? r.resolved : null;
}

/**
 * #147 — the agentic resolve fallback shared by the cancel + edit routes. On a deterministic 0-match for a
 * SPECIFIC reference, run the bounded resolve agent (forced to `search_events` on turn 0 — it has no
 * `extract_events`, so it can never create an event, AC#3) with the SERVER-resolved date/time pinned via
 * `ctx.resolveRef` (the model supplies only the text terms; it never sees today's date, G8). Returns the
 * matched board rows (possibly empty), or `null` when no resolve agent is wired — the caller then behaves
 * exactly as before (not-found). A TransientError propagates so the inbound stays pending for boot-replay.
 */
export async function resolveCandidates(
  deps: HandlerDeps,
  msg: InboundMessage,
  text: string,
  ref: { dateIso?: string; time?: string },
  today: string,
): Promise<SavedEvent[] | null> {
  if (!deps.resolveAgent) return null;
  const result = await deps.resolveAgent.run(
    text,
    {
      todayIso: today,
      from: msg.from,
      waMessageId: msg.id,
      senderName: deps.members?.[msg.from],
      familyId: FAMILY_ID,
      events: deps.events,
      resolveRef: {
        ...(ref.dateIso ? { dateIso: ref.dateIso } : {}),
        ...(ref.time ? { time: ref.time } : {}),
      },
    },
    { forceTool: "search_events" },
  );
  return resolvedOf(result) ?? [];
}
