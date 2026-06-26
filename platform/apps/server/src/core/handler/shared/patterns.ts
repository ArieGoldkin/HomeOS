/**
 * #228 — the binding token inside any surrounding prose; only `HOME-XXXXX` is load-bearing, so the regex
 * tolerates prepended/appended Hebrew text and edited prefill. The handler upper-cases the body first, so
 * a lowercased `home-` still matches. `[A-Z0-9]{5}` is intentionally broader than the mint alphabet (match
 * is tolerant; only a code that actually exists in `phone_binding` can bind).
 */
export const BINDING_CODE_RE = /\bHOME-[A-Z0-9]{5}\b/;
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
