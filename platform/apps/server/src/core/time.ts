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

/** The instant of `now`'s Jerusalem calendar-day midnight (DST-aware). Shared by the helpers below. */
function jerusalemDayStartInstant(now: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - jerusalemOffsetMinutes(now) * 60_000;
  return new Date(startMs);
}

/**
 * The start of `now`'s calendar day in Asia/Jerusalem, as a SQLite UTC datetime string. The G16
 * per-sender ceiling counts messages received at/after this instant, so the count *resets at
 * Jerusalem midnight* (DST-aware) rather than sliding over a rolling 24h window.
 */
export function jerusalemDayStartSqlite(now: Date): string {
  return sqliteUtc(jerusalemDayStartInstant(now));
}

/**
 * Jerusalem day-start as an RFC3339 instant (UTC `Z`) — the Calendar API `timeMin` (#18): "from the
 * start of today" so an event earlier today still surfaces, computed in Jerusalem time not UTC.
 */
export function jerusalemDayStartIso(now: Date): string {
  return jerusalemDayStartInstant(now).toISOString();
}

/** `now + days` as an RFC3339 instant — the Calendar API `timeMax` recency clamp (#18). */
export function addDaysIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/**
 * The Asia/Jerusalem wall-clock {date, time} for an instant (DST-aware), for mapping a Google Calendar
 * timed event's RFC3339 `dateTime` to the board's `date_iso` + `time` with NO UTC drift (#18, AC3): an
 * event at 23:30+03:00 on the 20th is the 20th in Jerusalem, not the 21st as a naive UTC read would give.
 */
export function jerusalemWallClock(instant: Date): { dateIso: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  // hour12:false can render "24" at midnight — normalize to "00".
  const hh = (Number(get("hour")) % 24).toString().padStart(2, "0");
  return {
    dateIso: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hh}:${get("minute")}`,
  };
}

/**
 * Add `hours` to a FLOATING Jerusalem wall-clock (`date_iso`, `HH:MM`), rolling the date over — the
 * default event-end on a Calendar write (#18 chunk 2): a timed event ends 1h after it starts; an
 * all-day event's exclusive end is the next day (`addWallClockHours(date, "00:00", 24).dateIso`).
 * Computed as floating time (the write carries `timeZone: "Asia/Jerusalem"`, so Google re-anchors it);
 * a DST transition landing exactly inside the added hour is not modelled (negligible for a 1h end).
 */
export function addWallClockHours(
  dateIso: string,
  time: string,
  hours: number,
): { dateIso: string; time: string } {
  const [y = 0, m = 1, d = 1] = dateIso.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh + hours, mm));
  const p = (n: number): string => String(n).padStart(2, "0");
  return {
    dateIso: `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`,
    time: `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`,
  };
}
