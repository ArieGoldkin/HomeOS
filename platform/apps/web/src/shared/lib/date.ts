const TZ = "Asia/Jerusalem";

/** Today's date in Asia/Jerusalem as `YYYY-MM-DD` (the board's anchor; the bot parses to this TZ). */
export function jerusalemTodayIso(now: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD; timeZone does the Asia/Jerusalem shift.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Weekday for a `YYYY-MM-DD` date — 0=Sunday … 6=Saturday (the Israeli week starts Sunday). */
export function weekdayIndex(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** The Sunday that starts the week containing `iso`, as `YYYY-MM-DD`. */
export function startOfWeekSundayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
