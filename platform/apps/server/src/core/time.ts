/**
 * Time helpers shared across the server. SQLite stores datetimes as UTC 'YYYY-MM-DD HH:MM:SS'
 * (via datetime('now')); these match that format and compute Asia/Jerusalem day boundaries so
 * counts (the daily digest, the G16 per-sender ceiling) line up with the wall-clock day.
 */

/** A JS Date → SQLite UTC datetime string 'YYYY-MM-DD HH:MM:SS' (matches `datetime('now')`). */
export function sqliteUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Asia/Jerusalem UTC offset in minutes at `instant` (DST-aware: +120 IST / +180 IDT). */
function jerusalemOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Read the Jerusalem wall-clock back as if it were UTC, then diff against the true instant.
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // en-US hour12:false can render "24" at midnight — normalize to 0
    get("minute"),
    get("second"),
  );
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/**
 * The start of `now`'s calendar day in Asia/Jerusalem, as a SQLite UTC datetime string. The G16
 * per-sender ceiling counts messages received at/after this instant, so the count *resets at
 * Jerusalem midnight* (DST-aware) rather than sliding over a rolling 24h window.
 */
export function jerusalemDayStartSqlite(now: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - jerusalemOffsetMinutes(now) * 60_000;
  return sqliteUtc(new Date(startMs));
}
