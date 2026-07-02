/**
 * #284 — the Asia/Jerusalem day-boundary helper for the WEB board (moved here from the web's
 * `shared/lib/date.ts`, which now re-exports it; it also backs the shared standing/attention
 * derivations so the board computes "today" one way). The server digest computes its day via
 * `core/time.ts`'s `jerusalemWallClock` — a separate code path with IDENTICAL `Intl` semantics
 * (`en-CA` + `Asia/Jerusalem`), so the two agree by construction rather than by sharing this fn.
 * A device with a wrong clock still computes the wrong day — `Intl` fixes the zone, not clock skew;
 * acceptable at family scale.
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
