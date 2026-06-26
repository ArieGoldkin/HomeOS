import type { ClarifyReason } from "@homeos/shared";

export const REFUSAL_HE = "מצטערים, אין לך הרשאה להשתמש בשירות הזה.";
export const TEXT_ONLY_HE = "כרגע אני מבין רק הודעות טקסט 🙏 (תמיכה בהודעות קוליות בקרוב).";
export const REPHRASE_HE = "לא הצלחתי להבין את ההודעה 🤔 אפשר לנסח מחדש?";
/** Slot dedup — a forward landed on a (date, time) slot already on the board: no second copy is made. */
export const ALREADY_HE = "כבר ביומן ✓";
export const TRANSIENT_HE = "אירעה תקלה זמנית 🙏 נסו שוב בעוד רגע.";
export const CANCEL_NONE_HE = "אין מה לבטל 🤷";
/** G16: quiet reply when a sender passes the daily message ceiling — no model call is made. */
export const RATE_LIMIT_HE = "הגעת למכסת ההודעות היומית 🙏 נמשיך מחר.";

/** #228 — Hebrew confirm when a valid code binds the sender's WhatsApp number to their family. */
export const BIND_OK_HE = "מצוין! המספר שלך חובר ל-HomeOS ✅";
/** #228 — the code was wrong, expired, or already used. */
export const BIND_INVALID_HE = "הקוד שגוי או שפג תוקפו 🙏 הפיקו קוד חדש מהאפליקציה ונסו שוב.";
/** #228 — the phone is already bound to a DIFFERENT family; never silently re-bind across tenants. */
export const BIND_WRONG_FAMILY_HE = "המספר הזה כבר מחובר למשפחה אחרת.";
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
export const CANCEL_NOT_FOUND_HE =
  "לא מצאתי אירוע כזה 🤷 שלחו שוב את הביטול עם תאריך מדויק בהודעה אחת — למשל: בטל פגישה עם רות ב-25.6";
export const CANCEL_WHICH_HE = "איזה מהם לבטל? השב/י במספרים (למשל 1 ו-2, או 'הכל'):";
/** #161 — edit's own disambiguation prompt (לעדכן, not the cancel-specific לבטל); same multi-select invite. */
export const EDIT_WHICH_HE = "איזה מהם לעדכן? השב/י במספרים (למשל 1 ו-2, או 'הכל'):";
/** #85 — bare "ביטול" while a thread is open ABORTS the thread (it never falls through to the undo). */
export const ABORT_THREAD_HE = "בסדר, ביטלתי 👍";
export const EDIT_SYNCED_HE = "אי אפשר לערוך אירוע שמסונכרן מהיומן 🔒";
/** #147 — the no-write reply when a confirm-before-destroy is declined / unanswered (fail-closed). */
export const CONFIRM_ABORT_HE = "בסדר, השארתי הכול כמו שהיה 👍";
/**
 * G2 — cap input length BEFORE any model call. A 50–100KB forward (long newsletters / pasted PDFs)
 * must never be sent to Claude (~2× per message once the agent loop lands). The allowlist bounds
 * *who*, not message *size*; this is the cost/DoS ceiling on a single message.
 */
export const MAX_INPUT = 4000;
