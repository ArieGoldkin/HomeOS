import { jerusalemHour } from "./date";

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
