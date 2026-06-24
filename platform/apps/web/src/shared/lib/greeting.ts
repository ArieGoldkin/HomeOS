import { ISO_DATE_RE, jerusalemHour } from "./date";

const TZ = "Asia/Jerusalem";

/** Time-of-day Hebrew greeting, anchored to Asia/Jerusalem (the board's timezone). */
export function greetingHe(now: Date = new Date()): string {
  const h = jerusalemHour(now);
  if (h >= 5 && h < 12) return "בוקר טוב";
  if (h >= 12 && h < 17) return "צהריים טובים";
  if (h >= 17 && h < 22) return "ערב טוב";
  return "לילה טוב";
}

/** Long Hebrew date for the Today kicker, e.g. "יום שני · 22 ביוני" (Asia/Jerusalem). */
export function hebDateLong(now: Date = new Date()): string {
  const weekday = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long" }).format(now);
  const dayMonth = new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ,
    day: "numeric",
    month: "long",
  }).format(now);
  return `${weekday} · ${dayMonth}`;
}

/**
 * #206 — a full Hebrew reading of a civil ISO date (`YYYY-MM-DD`), e.g. "יום רביעי, 24 ביוני 2026"
 * (he-IL, Asia/Jerusalem, with year). Used as a read-only hint under the native `<input type="date">`,
 * whose own display text follows the device locale (iOS Safari shows English regardless of `lang="he"`).
 * Returns "" for a malformed/empty value. Built from the civil date at noon-UTC so the Asia/Jerusalem day
 * never slips to the neighbour.
 */
export function hebDateFull(iso: string): string {
  if (!ISO_DATE_RE.test(iso)) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ""; // shape-valid but not a real day (e.g. 2026-13-45)
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}
