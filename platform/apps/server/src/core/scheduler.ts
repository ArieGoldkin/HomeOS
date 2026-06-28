const DAY_MS = 24 * 60 * 60 * 1000;

/** ms from `now` until the next `hour:00` in Asia/Jerusalem (wraps to tomorrow if already past). */
export function msUntilNextRun(now: Date, hour: number): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // en-GB 24h renders "HH:MM:SS"; "24" at midnight → normalize to 0.
  const parts = fmt.format(now).split(":").map(Number);
  const h = (parts[0] ?? 0) % 24;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  let secondsUntil = (hour - h) * 3600 - m * 60 - s;
  if (secondsUntil <= 0) secondsUntil += 24 * 3600;
  return secondsUntil * 1000;
}

export interface ScheduleOptions {
  now?: () => Date;
  onError?: (err: unknown) => void;
}

/**
 * Run `task` daily at `hour` Asia/Jerusalem, then every 24h. Returns `stop()` to cancel the timer.
 * A task rejection is routed to `onError` (default: swallow) so the loop keeps running. Shared by
 * the daily digest (D) and the nightly backup (I).
 */
export function scheduleDaily(
  hour: number,
  task: () => Promise<void>,
  opts: ScheduleOptions = {},
): { stop: () => void } {
  const now = opts.now ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout>;

  const tick = async () => {
    try {
      await task();
    } catch (err) {
      opts.onError?.(err);
    }
    timer = setTimeout(() => void tick(), DAY_MS);
  };

  timer = setTimeout(() => void tick(), msUntilNextRun(now(), hour));
  return { stop: () => clearTimeout(timer) };
}

/**
 * Run `task` every `intervalMs`, first fire after one interval. Returns `stop()` to cancel. A task
 * rejection is routed to `onError` (default: swallow) so the loop keeps running. Used by the offsite
 * backup (#134) where a fixed cadence — not a wall-clock hour — is what bounds the RPO.
 */
export function scheduleEvery(
  intervalMs: number,
  task: () => Promise<void>,
  opts: ScheduleOptions = {},
): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout>;

  const tick = async () => {
    try {
      await task();
    } catch (err) {
      opts.onError?.(err);
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };

  timer = setTimeout(() => void tick(), intervalMs);
  return { stop: () => clearTimeout(timer) };
}
