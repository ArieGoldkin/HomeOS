import { flags, HDate, HebrewCalendar } from "@hebcal/core";

/**
 * #25 — thin pure wrapper over `@hebcal/core` for the board's Hebrew-date + holiday display. Maps a civil
 * ISO date (`YYYY-MM-DD`, already Asia/Jerusalem-anchored upstream) directly to its Hebrew calendar date
 * and Israeli holidays. Timezone-agnostic by construction (a civil date → a Hebrew date is a pure calendar
 * mapping, no clock), so these functions are deterministic and unit-testable with no network or `Date.now`.
 * Display-only: feeding holiday-relative parsing (#6 item B) is deliberately deferred.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// What counts as a "holiday" worth showing an Israeli family: major festivals (CHAG), modern days
// (Independence/Memorial/Holocaust), major fasts (Yom Kippur, Tish'a B'Av), and the rabbinic holidays a
// family actually marks — Purim, Chanukah, Tu BiShvat, Lag BaOmer (MINOR_HOLIDAY). Deliberately EXCLUDES
// the liturgical noise `getHolidaysOnDate` also surfaces (Rosh Chodesh, minor fasts, parsha, omer, molad).
const MAJOR_MASK = flags.CHAG | flags.MODERN_HOLIDAY | flags.MAJOR_FAST | flags.MINOR_HOLIDAY;

/** Build an HDate from a civil ISO date using its Y/M/D components (NOT `new Date(iso)`, which is UTC and
 *  could shift the day under a non-UTC locale). Returns null on a malformed string. */
function hdateFromIso(iso: string): HDate | null {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return null;
  return new HDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** The Hebrew calendar date for a civil ISO date, e.g. "10 תשרי" (no nikud, no year). "" on bad input. */
export function hebrewDateLabel(iso: string): string {
  return hdateFromIso(iso)?.render("he-x-NoNikud", false) ?? "";
}

/**
 * Major Israeli holiday name(s) (Hebrew, no nikud) on a civil ISO date — `[]` when none. Israel scheme
 * (`il: true`), so a Diaspora-only second yom-tov day is correctly NOT a holiday here.
 */
export function holidaysOn(iso: string): string[] {
  const hd = hdateFromIso(iso);
  if (!hd) return [];
  const events = HebrewCalendar.getHolidaysOnDate(hd, true) ?? [];
  return (
    events
      .filter((e) => {
        const f = e.getFlags();
        if ((f & MAJOR_MASK) === 0) return false;
        // Drop holiday EVES (Erev Pesach, etc.) — EXCEPT Chanukah night 1, which hebcal tags EREV
        // (candle-lighting starts at night) but IS the start of the holiday, not a pre-festival eve.
        return (f & flags.EREV) === 0 || (f & flags.CHANUKAH_CANDLES) !== 0;
      })
      // Rosh Hashana is the one event hebcal renders WITH a year ("ראש השנה 5786"); strip the trailing
      // year so every chip reads consistently (no other holiday name ends in digits).
      .map((e) => e.render("he-x-NoNikud").replace(/\s+\d{3,4}$/u, ""))
  );
}
