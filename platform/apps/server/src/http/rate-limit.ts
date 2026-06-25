/**
 * #107 — a MINIMAL per-IP fixed-window counter (NOT a throttling subsystem). It bounds how many
 * self-serve attempts a single source IP can make per window; once the ceiling is reached inside the
 * window it reports `limited` (HTTP 429 semantics), and the count resets when the window rolls over.
 *
 * The clock is injected (`now`) so window roll-over is deterministic in tests, and the mismatch delay
 * is a separate injectable helper so the wrong-bearer path can sleep in production yet stay instant
 * (delay 0 / a fake sleep) in tests. NOT wired into any route here — #108 does the wiring.
 */

export interface RateLimiterOptions {
  /** Fixed window length in ms. */
  windowMs: number;
  /** Max attempts permitted per IP within a window (the inclusive ceiling). */
  max: number;
  /** Fixed delay (ms) applied on a wrong-bearer path; injectable/0 so tests don't sleep. */
  mismatchDelayMs?: number;
  /** Injected clock — `() => epochMs`. Defaults to `Date.now`. */
  now?: () => number;
}

export interface RateLimitResult {
  /** True once the per-IP attempts have exceeded `max` inside the current window (429-able). */
  limited: boolean;
}

export interface RateLimiter {
  /** Record one attempt for `ip` and report whether it is now over the window ceiling. */
  check(ip: string): RateLimitResult;
  /** The configured fixed mismatch delay (ms), surfaced for the wrong-bearer path. */
  readonly mismatchDelayMs: number;
}

interface Bucket {
  /** Start of the fixed window this count belongs to (epoch ms, window-aligned). */
  windowStart: number;
  count: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now;
  const mismatchDelayMs = opts.mismatchDelayMs ?? 0;
  const buckets = new Map<string, Bucket>();

  return {
    mismatchDelayMs,
    check(ip) {
      const t = now();
      const windowStart = t - (t % opts.windowMs); // align to the fixed window
      const bucket = buckets.get(ip);
      if (!bucket || bucket.windowStart !== windowStart) {
        // Fresh window (or first sighting) — reset the counter to this single attempt.
        buckets.set(ip, { windowStart, count: 1 });
        return { limited: false };
      }
      bucket.count += 1;
      return { limited: bucket.count > opts.max };
    },
  };
}

/**
 * Await a fixed mismatch delay on the wrong-bearer path. The sleeper is injectable so production
 * passes a real timer while tests pass a fake (or rely on `ms === 0` being a no-op) and never sleep.
 */
export function mismatchDelay(
  ms: number,
  sleep: (ms: number) => Promise<void> = (d) => new Promise((r) => setTimeout(r, d)),
): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return sleep(ms);
}
