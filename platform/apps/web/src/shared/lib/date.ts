import { jerusalemTodayIso } from "@homeos/shared";

const TZ = "Asia/Jerusalem";

// #284 — jerusalemTodayIso moved to @homeos/shared (ONE day-boundary truth for web + server/digest);
// re-exported here so every existing @shared/lib caller keeps working unchanged.
export { jerusalemTodayIso };

/**
 * Shape guard for an ISO calendar date `YYYY-MM-DD`. Shape only — it does NOT verify the date is real
 * (e.g. "2026-13-45" matches). The single source for both `coerceDateIso` and the router's
 * `validateSearch`, so the accepted `?date=` shape is declared exactly once.
 */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce an untrusted date (e.g. a `?date=` URL param) to a `YYYY-MM-DD`, falling back to today when
 * it's missing or the wrong shape. The screens call this so a bad URL never reaches the date math.
 */
export function coerceDateIso(raw: string | null | undefined, now: Date = new Date()): string {
  return typeof raw === "string" && ISO_DATE_RE.test(raw) ? raw : jerusalemTodayIso(now);
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

/** Wall-clock `HH:MM` (24h) in Asia/Jerusalem — the tablet clock + the NowLine marker time. */
export function jerusalemHhmm(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/** The 0–23 hour in Asia/Jerusalem (drives the time-of-day greeting). */
export function jerusalemHour(now: Date = new Date()): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return Number.parseInt(hh, 10);
}

/** `YYYY-MM-DD` shifted by `days` (UTC calendar math; crosses month/year). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
