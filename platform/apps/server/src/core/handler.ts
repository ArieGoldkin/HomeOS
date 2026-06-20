import {
  type ClarifyReason,
  type ParsedEvent,
  parsedEventSchema,
  sanitizeUserText,
} from "@homeos/shared";
import {
  type ConversationStore,
  cancelPayloadSchema,
  clarifyPayloadSchema,
  editPayloadSchema,
} from "../db/conversation-store.ts";
import type { EventPatch, EventStore, SavedEvent } from "../db/event-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import { type ConversationRow, FAMILY_ID } from "../db/schema.ts";
import type { InboundMessage } from "../http/webhook.ts";
import type { ParseMessage } from "../parsing/parser.ts";
import {
  type CalendarToolDeps,
  type ClarifyResult,
  deleteFromCalendar,
  type GmailToolDeps,
  pushSavedEventsToCalendar,
  type ToolContext,
} from "../tools/tools.ts";
import type { SendText } from "../whatsapp/client.ts";
import type { Agent, AgentResult } from "./agent.ts";
import { isAllowed } from "./allowlist.ts";
import { TransientError } from "./errors.ts";
import { jerusalemDayStartSqlite, sqliteUtc } from "./time.ts";

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
 * #84 — SERVER-OWNED Hebrew clarify templates. The model NEVER composes the question (Meta 2026
 * single-purpose red line): it only emits a constrained reason enum; the handler picks the template.
 * `Partial` + a `REPHRASE_HE` fallback honours "no template → rephrase". Only the required-slot reasons
 * the gate can emit are present; `missing_time` is intentionally absent (it never opens a thread).
 */
const CLARIFY_QUESTIONS: Partial<Record<ClarifyReason, string>> = {
  missing_date: "לא הבנתי מתי זה — לאיזה תאריך לקבוע? 🗓️",
  ambiguous_title: "מה לרשום ככותרת? 🤔",
};
/** Open-thread TTL (#84/G24): a clarify question expires after 30 min so a stale "מתי זה?" never resumes. */
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
/**
 * #85 cancel-BY-REFERENCE (distinct from bare ביטול): a deterministic verb-prefix route — "בטל/מחק/הסר
 * <ref>". The `\S+` requires a referent so a bare "ביטול" still hits the undo branch. The reference is
 * extracted SERVER-side (no model call); the family lookup decides 0/1/N, never the message content.
 */
const CANCEL_REF_RE = /^(בטל|מחק|הסר)\s+\S+/u;
const TIME_RE = /(\d{1,2}):(\d{2})/u;
const CANCEL_NOT_FOUND_HE = "לא מצאתי אירוע כזה 🤷 נסו עם תאריך/שעה מדויקים";
const CANCEL_WHICH_HE = "איזה מהם לבטל? השב/י במספר:";
/** #85 — bare "ביטול" while a thread is open ABORTS the thread (it never falls through to the undo). */
const ABORT_THREAD_HE = "בסדר, ביטלתי 👍";
/**
 * #86 edit-in-place: explicit "שנה/ערוך/תקן/עדכן <ref> <delta>" (deterministic, NO model call). The
 * CORRECTION variant ("לא ב-28, ב-21") fires only INSIDE an open thread (G21). The field delta comes
 * from a FIXED vocabulary (ל-HH:MM/לשעה→time, למיקום/לכתובת→location, ל-DD→day-of-month) — no open domain.
 */
const EDIT_REF_RE = /^(שנה|ערוך|תקן|עדכן)\s+\S+/u;
const CORRECTION_RE = /^לא,?\s+(ב-|ה-|בשעה|במיקום)/u;
const EDIT_TIME_RE = /ל(?:שעה\s*)?-?\s*(\d{1,2}):(\d{2})/u;
// #126/F2 — non-greedy + bounded: the location stops before a following ל-/בשעה time/day token so it
// can't swallow it (e.g. "למיקום בית הספר ל-18:00" → location "בית הספר", time still extracted).
const EDIT_LOCATION_RE = /ל(?:מיקום|כתובת)\s+(.+?)(?=\s+ל-?\s*\d|\s+בשעה|$)/u;
const EDIT_DAY_RE = /ל-?(\d{1,2})(?![:\d])/u;
const EDIT_SYNCED_HE = "אי אפשר לערוך אירוע שמסונכרן מהיומן 🔒";
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
  let result: AgentResult;
  try {
    result = await deps.agent.run(intent, ctx, { forceTool });
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
  // The sync tools (read_gmail/read_calendar) only ever return saved rows — never a clarify; narrow
  // defensively so a clarify (which the gate can't produce here) degrades to "nothing new", not a throw.
  const synced = savedOf(result);
  if (!synced || synced.length === 0) {
    await deps.sendText(msg.from, noneReply);
    return;
  }
  log("synced provider events", { from: msg.from, tool: forceTool, count: synced.length });
  await deps.sendText(msg.from, formatConfirm(synced));
}

/**
 * Resume an open conversation thread (#83, Milestone #8 foundation). Routes the sender's next message
 * to the deterministic resolution for the thread's `kind` — NEVER back through `agent.run` (G17: a
 * clarify answer must not be re-parsed as a fresh forward, nor enter an auto agent turn). The thread is
 * consumed up front (`resolve` DELETEs it — single-use, G24), so a Meta at-least-once redelivery finds
 * nothing pending and falls through to the normal path. For #83 the `clarify` arm is a trivial ECHO
 * STUB that proves ask→wait→resume end-to-end; #84 replaces it with the slot-merge + re-validation,
 * and #85/#86 add the `cancel`/`edit` arms.
 */
async function handleResume(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});
  switch (row.kind) {
    case "clarify":
      // resumeClarify OWNS the resolve so a TRANSIENT re-parse error leaves the thread intact for
      // boot-replay (F2) — resolving up front would drop the held draft on a provider blip.
      return resumeClarify(deps, msg, row);
    case "cancel":
      return resumeCancel(deps, msg, row);
    case "edit":
      return resumeEdit(deps, msg, row);
    default:
      // an unknown/forward-incompatible kind: consume defensively and ask to rephrase rather than
      // silently drop an answer to a thread this version doesn't know how to resume.
      deps.conversations?.resolve(row.id);
      log("resume — unimplemented kind", { from: msg.from, id: row.id, kind: row.kind });
      await deps.sendText(msg.from, REPHRASE_HE);
      return;
  }
}

/** JSON.parse that returns null instead of throwing on a corrupt blob (paired with clarifyPayloadSchema). */
function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

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
async function resumeClarify(
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

/** 0=Sunday … 6=Saturday — the Israeli week. Matched with or without a "ביום"/"יום" prefix. */
const HEBREW_WEEKDAYS: Record<string, number> = {
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
const WEEKDAY_RE = /(?<!\p{L})(?:ב?יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?!\p{L})/u;

/** `todayIso` (YYYY-MM-DD) + N days via date-only UTC math (no TZ drift for a calendar-day add). */
function addDaysIso(iso: string, days: number): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
function weekdayOfIso(iso: string): number {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** #86 — does the text carry a date/time signal (weekday / relative-date / HH:MM / D.M)? A "לא …" that
 *  isn't a field correction but DOES carry one is a real new forward, not a thread non-answer. */
function hasScheduleSignal(text: string): boolean {
  return (
    WEEKDAY_RE.test(text) ||
    /(?<!\p{L})(?:היום|מחר|מחרתיים)(?!\p{L})/u.test(text) ||
    TIME_RE.test(text) ||
    /\d{1,2}[./]\d{1,2}/u.test(text)
  );
}

/**
 * #85 — extract a cancel REFERENCE server-side (NO model call): strip the verb, then pull an explicit
 * time (HH:MM, hour zero-padded), a relative Hebrew DATE (היום/מחר/מחרתיים or a weekday → its next
 * occurrence, #125/F2), and treat the remaining content words as a title substring hint. Exported so the
 * extraction contract is unit-tested. (The 12h/24h expansion — "3:30" also matching 15:30 — stays a #87
 * refinement; today a low bare hour matches its 24h form.)
 */
export function extractCancelRef(
  text: string,
  todayIso: string,
): { dateIso?: string; time?: string; titleHint?: string } {
  let rest = text.replace(/^(בטל|מחק|הסר)\s+/u, "");

  let time: string | undefined;
  const tm = TIME_RE.exec(rest);
  if (tm?.[1] && tm[2]) {
    time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
    rest = rest.replace(TIME_RE, " ");
  }

  // Resolve a relative date so the words don't pollute the title hint AND a date-bearing cancel matches.
  // מחרתיים is tested BEFORE מחר; a weekday name resolves to its NEXT occurrence (0 = today, never past).
  let dateIso: string | undefined;
  if (/(?<!\p{L})היום(?!\p{L})/u.test(rest)) {
    dateIso = todayIso;
    rest = rest.replace(/(?<!\p{L})היום(?!\p{L})/u, " ");
  } else if (/(?<!\p{L})מחרתיים(?!\p{L})/u.test(rest)) {
    dateIso = addDaysIso(todayIso, 2);
    rest = rest.replace(/(?<!\p{L})מחרתיים(?!\p{L})/u, " ");
  } else if (/(?<!\p{L})מחר(?!\p{L})/u.test(rest)) {
    dateIso = addDaysIso(todayIso, 1);
    rest = rest.replace(/(?<!\p{L})מחר(?!\p{L})/u, " ");
  } else {
    const wd = WEEKDAY_RE.exec(rest);
    const target = wd?.[1] !== undefined ? HEBREW_WEEKDAYS[wd[1]] : undefined;
    if (wd && target !== undefined) {
      dateIso = addDaysIso(todayIso, (target - weekdayOfIso(todayIso) + 7) % 7);
      rest = rest.replace(wd[0], " ");
    }
  }

  const titleHint = rest
    .replace(/(?<!\p{L})את(?!\p{L})/gu, " ")
    .replace(/(?<!\p{L})יום(?!\p{L})/gu, " ")
    .replace(/[-־]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    ...(dateIso ? { dateIso } : {}),
    ...(time ? { time } : {}),
    ...(titleHint ? { titleHint } : {}),
  };
}

/**
 * #85 — delete ONE board row + its best-effort Google mirror, then confirm. Shared by the 1-match and the
 * resume-index paths. G25: the Google delete never throws (the board is the source of truth).
 */
async function cancelOne(deps: HandlerDeps, msg: InboundMessage, eventId: number): Promise<void> {
  const log = deps.log ?? (() => {});
  const removed = deps.events.deleteById(eventId, FAMILY_ID);
  if (removed > 0 && deps.calendar) {
    await deleteFromCalendar(eventId, deps.calendar, FAMILY_ID, log);
  }
  log("cancel-by-ref delete", { from: msg.from, eventId, removed });
  await deps.sendText(msg.from, cancelReply(removed));
}

/**
 * #85 — resume a cancel disambiguation: a numbered reply (^[1-5]$) picks ONE candidate → delete it; any
 * non-index reply deletes NOTHING (G20 never auto-pick). Single-use: the thread is resolved up front (no
 * model call here, so nothing to leave pending). The persisted payload is re-validated (F3).
 */
async function resumeCancel(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});
  deps.conversations?.resolve(row.id); // single-use (turn cap 1)
  const parsed = cancelPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  if (!parsed.success) {
    log("cancel resume — invalid persisted payload", { from: msg.from, id: row.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const m = /^([1-5])$/.exec(msg.text?.trim() ?? "");
  const id = m?.[1] ? parsed.data.candidateIds[Number(m[1]) - 1] : undefined;
  if (id === undefined) {
    // a non-index (or out-of-range) reply → no delete; the user can re-issue the cancel.
    log("cancel resume — non-index reply, no delete", { from: msg.from });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  await cancelOne(deps, msg, id);
}

/**
 * #86 — extract an explicit-edit REFERENCE + a field DELTA from a fixed vocabulary (server-side, NO
 * model call). Returns null when no recognized delta is present, so "שנה X" without a `ל-<field>` is a
 * miss (not a no-op write). "ל-DD" resolves to that day of TODAY's month (cross-month is a #87 item).
 */
function extractEditDelta(
  text: string,
  todayIso: string,
): { ref: { dateIso?: string; time?: string; titleHint?: string }; patch: EventPatch } | null {
  let rest = text.replace(/^(שנה|ערוך|תקן|עדכן)\s+/u, "");
  const patch: EventPatch = {};
  const loc = EDIT_LOCATION_RE.exec(rest);
  if (loc?.[1]) {
    patch.location = sanitizeUserText(loc[1].trim());
    rest = rest.replace(EDIT_LOCATION_RE, " ");
  }
  const tm = EDIT_TIME_RE.exec(rest);
  if (tm?.[1] && tm[2]) {
    patch.time = `${String(Number(tm[1])).padStart(2, "0")}:${tm[2]}`;
    rest = rest.replace(EDIT_TIME_RE, " ");
  }
  const dy = EDIT_DAY_RE.exec(rest);
  if (dy?.[1]) {
    patch.date_iso = `${todayIso.slice(0, 8)}${String(Number(dy[1])).padStart(2, "0")}`;
    rest = rest.replace(EDIT_DAY_RE, " ");
  }
  if (Object.keys(patch).length === 0) return null;
  return { ref: extractCancelRef(rest, todayIso), patch };
}

/**
 * #86 — apply a patch to ONE board row by id: updateEvent re-validates the merge + enforces board-only
 * (G20/G19), then best-effort Calendar patch (reusing the push helper's find(homeosEventId)→patch — no
 * new client method), then "עודכן ✓" built SERVER-side from the updated row (G7). Null update → rephrase.
 */
async function applyPatchToId(
  deps: HandlerDeps,
  msg: InboundMessage,
  id: number,
  patch: EventPatch,
): Promise<void> {
  const log = deps.log ?? (() => {});
  const updated = deps.events.updateEvent(id, patch, FAMILY_ID);
  if (!updated) {
    await deps.sendText(msg.from, REPHRASE_HE); // synced row / invalid merge → no write happened
    return;
  }
  if (deps.calendar) {
    await pushSavedEventsToCalendar([updated], deps.calendar, FAMILY_ID, log); // G25 best-effort
  }
  log("edit applied", { from: msg.from, id: updated.id });
  await deps.sendText(msg.from, `עודכן ✓\n${updated.title_he} · ${formatWhen(updated)}`);
}

/** #86 — the explicit 1-match edit: refuse a synced row up front (a read→write loop), else apply. */
async function applyEdit(
  deps: HandlerDeps,
  msg: InboundMessage,
  candidate: SavedEvent,
  patch: EventPatch,
): Promise<void> {
  if (candidate.source_provider !== null) {
    await deps.sendText(msg.from, EDIT_SYNCED_HE); // gcal/gmail row → refuse, NO write
    return;
  }
  await applyPatchToId(deps, msg, candidate.id, patch);
}

/**
 * #86 — resume an edit disambiguation: a numbered reply picks ONE candidate → apply the held patch
 * (updateEvent enforces board-only, so a synced id can't be written). Non-index → no write. Single-use.
 */
async function resumeEdit(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
): Promise<void> {
  const log = deps.log ?? (() => {});
  deps.conversations?.resolve(row.id); // single-use (turn cap 1)
  const parsed = editPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  if (!parsed.success) {
    log("edit resume — invalid persisted payload", { from: msg.from, id: row.id });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const m = /^([1-5])$/.exec(msg.text?.trim() ?? "");
  const id = m?.[1] ? parsed.data.candidateIds[Number(m[1]) - 1] : undefined;
  if (id === undefined) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  await applyPatchToId(deps, msg, id, parsed.data.patch);
}

/**
 * #86 — extract the NEW field value from a terse correction ("לא ב-28, ב-21" → day 21; "לא בשעה 4:00" →
 * time; "לא במיקום X" → location). Takes the LAST value of each field (the ASSERTED one, after the
 * negated one). Day resolves to today's month (#87: cross-month). Null when no field is present.
 */
function extractCorrectionDelta(text: string, todayIso: string): EventPatch | null {
  const patch: EventPatch = {};
  // #126/F2 — bounded so it can't swallow a trailing time/day token ("במיקום בית הספר בשעה 18:00").
  const loc = /במיקום\s+(.+?)(?=\s+בשעה|\s+[בל]-?\s*\d|$)/u.exec(text);
  if (loc?.[1]) patch.location = sanitizeUserText(loc[1].trim());
  const lastT = [...text.matchAll(/(\d{1,2}):(\d{2})/gu)].at(-1);
  if (lastT?.[1] && lastT[2])
    patch.time = `${String(Number(lastT[1])).padStart(2, "0")}:${lastT[2]}`;
  const lastD = [...text.matchAll(/ב-?(\d{1,2})(?![:\d])/gu)].at(-1);
  if (lastD?.[1])
    patch.date_iso = `${todayIso.slice(0, 8)}${String(Number(lastD[1])).padStart(2, "0")}`;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * #86 CORRECTION (the live 2-reminder bug fix) — apply a terse "לא …" correction to the held CLARIFY
 * draft IN PLACE (never a 2nd event): merge the new field value, re-validate, save + confirm. A clarify
 * draft was never persisted, so completing it here is one save, not a duplicate. Single-use.
 */
async function applyCorrection(
  deps: HandlerDeps,
  msg: InboundMessage,
  row: ConversationRow,
  todayIso: string,
): Promise<void> {
  const log = deps.log ?? (() => {});
  deps.conversations?.resolve(row.id);
  const parsed = clarifyPayloadSchema.safeParse(safeJsonParse(row.payload_json));
  const delta = extractCorrectionDelta(msg.text?.trim() ?? "", todayIso);
  // Corrections target a single held draft → clarify threads only; anything else degrades to rephrase.
  if (!parsed.success || !delta) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const validated = parsedEventSchema.safeParse({
    ...parsed.data.draft,
    ...delta,
    needs_clarification: undefined,
  });
  if (!validated.success) {
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }
  const saved = deps.events.saveEvent(validated.data, { fromPhone: msg.from, waMessageId: msg.id });
  log("correction applied", { from: msg.from, id: saved.id });
  await deps.sendText(msg.from, formatConfirm([saved]));
  if (deps.autoPushCalendar && deps.calendar) {
    const { pushed } = await pushSavedEventsToCalendar([saved], deps.calendar, FAMILY_ID, log);
    if (pushed > 0) log("auto-pushed correction", { id: msg.id, pushed });
  }
}

/**
 * #84 — open a clarify thread: pick the SERVER-OWNED template for the model's reason enum, persist the
 * draft on a `kind:'clarify'` thread (#83 store), send ONE question, save NOTHING, no confirm. No
 * template (or no store wired) → REPHRASE_HE. processInbound marks the inbound done on normal return, so
 * boot-replay never re-asks (the conversation row carries the open state). Red-line: the user only ever
 * sees a server template, never model prose.
 */
async function openClarifyThread(
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
    new Date((deps.now ?? (() => new Date()))().getTime() + CONVERSATION_TTL_MS),
  );
  deps.conversations.create({
    fromPhone: msg.from,
    payload: { kind: "clarify", reason: clarify.reason, draft: clarify.draft },
    expiresAt,
  });
  log("clarify thread opened", { from: msg.from, reason: clarify.reason });
  await deps.sendText(msg.from, question);
}

/** #84: narrow the agent's 3-arm result. `clarify` → the request to ask; otherwise saved rows (or null). */
function clarifyOf(r: AgentResult): ClarifyResult | null {
  return r && "clarify" in r ? r.clarify : null;
}
function savedOf(r: AgentResult): SavedEvent[] | null {
  return r && "clarify" in r ? null : r;
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

  // G2: input-length cap — short-circuit BEFORE any model call, including the clarify-RESUME re-parse
  // below (an answer to "מתי זה?" is model-bound too). Placed ahead of the resume + exact-match triggers
  // (ביטול/syncs are short, so capping them is harmless) so no path can send Claude an oversized payload.
  if (text.length > MAX_INPUT) {
    log("input over MAX_INPUT — rephrase", { id: msg.id, len: text.length });
    await deps.sendText(msg.from, REPHRASE_HE);
    return;
  }

  // #83 RESUME branch (Milestone #8) — ORDER IS LOAD-BEARING (G22): it sits AFTER the allowlist + G16
  // rate gate + text-only guard and BEFORE ביטול / any agent.run. When the sender has an open thread,
  // their next message is an ANSWER → route it to the deterministic resume, never re-parse it as a
  // fresh forward (G17). Sweep stale rows first (G24 boot+per-inbound) so an expired question never
  // resumes. Inert unless `conversations` is wired, so the branch is fully additive.
  if (deps.conversations) {
    const nowSqlite = sqliteUtc((deps.now ?? (() => new Date()))());
    deps.conversations.expireStale(nowSqlite);
    const pending = deps.conversations.getPending(msg.from, nowSqlite);
    if (pending) {
      // Bare "ביטול" is the universal escape hatch: it ABORTS the open thread (resolve, NO undo) — the
      // open op takes precedence over the last-message undo (§2).
      if (text === CANCEL_TRIGGER) {
        deps.conversations.resolve(pending.id);
        log("aborted open thread via ביטול", { from: msg.from, id: pending.id });
        await deps.sendText(msg.from, ABORT_THREAD_HE);
        return;
      }
      // #86 CORRECTION: a terse "לא ב-/בשעה/במיקום …" corrects the held draft IN PLACE (G21).
      if (CORRECTION_RE.test(text)) {
        await applyCorrection(deps, msg, pending, today);
        return;
      }
      // #86 false-positive guard: a "לא …" that ISN'T a field correction but DOES carry a date/time
      // (e.g. "לא נשכח את יום ההולדת ביום שישי") is a NEW forward, not a thread answer — abort the thread
      // and let it fall through to agent.run. A bare "לא יודע" (no schedule signal) is just a non-answer
      // → handleResume (→ rephrase / re-parse). Any other message is the thread's answer → handleResume.
      if (/^לא[\s,]/u.test(text) && hasScheduleSignal(text)) {
        deps.conversations.resolve(pending.id);
        log("non-correction 'לא' with a schedule signal → new forward", { from: msg.from });
      } else {
        await handleResume(deps, msg, pending);
        return;
      }
    }
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

  // #85 cancel-BY-REFERENCE: a deterministic route (NO model call) — "בטל/מחק/הסר <ref>". The reference
  // is extracted SERVER-side; findEventsByRef scopes to the family's board rows (source_provider IS NULL).
  // 0 → not-found; 1 → delete + best-effort Google delete; N>1 → a numbered disambiguation thread (never
  // auto-pick — the board is shared, G20). A forward that merely CONTAINS "בטל…" deletes nothing unless a
  // real board event matches (state-not-content, G22).
  if (CANCEL_REF_RE.test(text)) {
    const ref = extractCancelRef(text, today);
    // #125/F1 — require a SPECIFIC reference before touching the family's board: a bare verb or a
    // stopword-only "בטל את" (and a coincidental forward that merely starts with בטל) must NOT match
    // and silently delete. Need a time, a date, or a title hint of ≥2 chars.
    const specific = Boolean(
      ref.time || ref.dateIso || (ref.titleHint && ref.titleHint.length >= 2),
    );
    if (!specific) {
      await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
      return;
    }
    const candidates = deps.events.findEventsByRef(FAMILY_ID, ref);
    if (candidates.length === 0) {
      await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
      return;
    }
    if (candidates.length === 1) {
      await cancelOne(deps, msg, candidates[0]!.id);
      return;
    }
    if (deps.conversations) {
      const list = candidates
        .map((e, i) => `${i + 1}. ${e.title_he} · ${formatWhen(e)}`)
        .join("\n");
      const expiresAt = sqliteUtc(
        new Date((deps.now ?? (() => new Date()))().getTime() + CONVERSATION_TTL_MS),
      );
      deps.conversations.create({
        fromPhone: msg.from,
        payload: { kind: "cancel", candidateIds: candidates.map((e) => e.id) },
        expiresAt,
      });
      log("cancel-by-ref disambiguation opened", { from: msg.from, count: candidates.length });
      await deps.sendText(msg.from, `${CANCEL_WHICH_HE}\n${list}`);
    } else {
      await deps.sendText(msg.from, REPHRASE_HE); // no store wired → can't disambiguate
    }
    return;
  }

  // #86 EXPLICIT EDIT: "שנה/ערוך/תקן/עדכן <ref> ל-<field>" — deterministic (NO model call). Needs a
  // recognized field delta AND a specific reference; 0 (לא מצאתי) | 1 (apply, refusing a synced row) |
  // N>1 (numbered kind='edit' thread holding the patch). Same family/state-not-content guards as cancel.
  if (EDIT_REF_RE.test(text)) {
    const edit = extractEditDelta(text, today);
    const ref = edit?.ref;
    const specific = Boolean(
      ref?.time || ref?.dateIso || (ref?.titleHint && ref.titleHint.length >= 2),
    );
    if (!edit || !specific) {
      await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
      return;
    }
    const candidates = deps.events.findEventsByRef(FAMILY_ID, edit.ref);
    if (candidates.length === 0) {
      await deps.sendText(msg.from, CANCEL_NOT_FOUND_HE);
      return;
    }
    if (candidates.length === 1) {
      await applyEdit(deps, msg, candidates[0]!, edit.patch);
      return;
    }
    if (deps.conversations) {
      const list = candidates
        .map((e, i) => `${i + 1}. ${e.title_he} · ${formatWhen(e)}`)
        .join("\n");
      const expiresAt = sqliteUtc(
        new Date((deps.now ?? (() => new Date()))().getTime() + CONVERSATION_TTL_MS),
      );
      deps.conversations.create({
        fromPhone: msg.from,
        payload: { kind: "edit", candidateIds: candidates.map((e) => e.id), patch: edit.patch },
        expiresAt,
      });
      log("edit disambiguation opened", { from: msg.from, count: candidates.length });
      await deps.sendText(msg.from, `${CANCEL_WHICH_HE}\n${list}`);
    } else {
      await deps.sendText(msg.from, REPHRASE_HE);
    }
    return;
  }

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

  // #84: the parse flagged a required-slot guess → ask ONE templated question + open a thread; save
  // NOTHING, no confirm. The next message resumes via the #83 RESUME branch above.
  const clarify = clarifyOf(result);
  if (clarify) {
    await openClarifyThread(deps, msg, clarify);
    return;
  }

  const saved = savedOf(result);
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
