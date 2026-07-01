// #224 — the DETERMINISTIC lexical gate for a standing DAILY reminder. Kept out of the model's hands: the
// parser sets `standing:{cadence:"daily"}` for a `reminder` iff its text matches this allowlist, so a stray
// model value can never create a runaway recurring reminder. Conservative by design — a false positive means
// 30 days of unwanted digest nudges, so the phrases are the unambiguous daily-cadence ones only.

const WEEKDAYS = "ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת";

/**
 * Matches the Hebrew daily-cadence phrases while dodging the two look-alike traps:
 *  - "באופן קבוע" — "regularly / on a standing basis" (the canonical trigger, #224's example).
 *  - "כל יום" / "בכל יום" / "מדי יום" — "every day", BUT:
 *      · `(?![א-ת])` excludes "כל יומיים" (every TWO days — יום followed by another Hebrew letter),
 *      · `(?!\s+(weekday))` excludes "כל יום ראשון" (every SUNDAY — that's weekly recurrence, not daily).
 * Unicode-aware (`u`). Bare "יומי"/"יומית" are deliberately NOT triggers — too collision-prone with
 * "יומיים" — so the gate stays conservative; richer phrases can be added later behind their own tests.
 */
const STANDING_DAILY_RE = new RegExp(
  // `(?<![א-ת])` LEFT boundary so "כל יום" doesn't false-match inside "הכל יום" / "אוכל יום"; `(?![א-ת])`
  // RIGHT boundary excludes "יומיים" (two days); `(?!\s+weekday)` excludes "כל יום ראשון" (weekly, not daily).
  `באופן קבוע|(?<![א-ת])(?:ב?כל|מדי) יום(?![א-ת])(?!\\s+(?:${WEEKDAYS}))`,
  "u",
);

/** True iff `text` carries an unambiguous daily-cadence phrase (see {@link STANDING_DAILY_RE}). */
export function detectStandingDaily(text: string): boolean {
  return STANDING_DAILY_RE.test(text);
}
