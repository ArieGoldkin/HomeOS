/**
 * #284 — the ONE Asia/Jerusalem day-boundary producer, shared by the web app and the server so the
 * board and the digest can never disagree about "today" at midnight. (Moved here from the web's
 * `shared/lib/date.ts`, which now re-exports it.) A device with a wrong clock still computes the
 * wrong day — `Intl` fixes the zone, not clock skew; acceptable at family scale.
 */
const TZ = "Asia/Jerusalem";

/** Today's `YYYY-MM-DD` in Asia/Jerusalem (en-CA renders ISO; timeZone does the shift). */
export function jerusalemTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
