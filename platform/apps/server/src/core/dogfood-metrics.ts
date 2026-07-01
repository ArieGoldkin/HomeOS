import type { DogfoodMetricsResponse } from "@homeos/shared";
import type { InboundStore } from "../db/inbound-store.ts";
import type { MetricsStore } from "../db/metrics-store.ts";
import { sqliteUtc } from "./time.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** #26 — the Phase-6 exit thresholds. Overridable for tests; the defaults are the issue's stated gates. */
export interface DogfoodThresholds {
  /** ≥1 forward/day (averaged over the window). */
  forwardsPerDay: number;
  /** parse accuracy ~80%. */
  parseAccuracy: number;
  /** share of window days the board was active (INFORMATIONAL — see below). */
  glanceRate: number;
}

export const DEFAULT_DOGFOOD_THRESHOLDS: DogfoodThresholds = {
  forwardsPerDay: 1,
  parseAccuracy: 0.8,
  glanceRate: 0.7,
};

/**
 * #26 — compute the dogfood-month validation metrics + go/no-go from the existing pipeline (counts only, no
 * PII). Pure over the two injected stores + `now`.
 *
 * The two VERDICT gates are honest, family-scoped signals:
 *  - forward-habit: forwards/day, SCOPED to `fromPhones` (the allowlist) so pre-allowlist spam — persisted
 *    before the gate — can't inflate it.
 *  - parse-accuracy: `parsed ÷ (parsed + clarified + rephrase)` — a `clarified` (needed a round-trip) and a
 *    `rephrase` (unparseable) both count AGAINST clean accuracy; null when there were no parse attempts.
 *
 * Board engagement is INFORMATIONAL, not verdict-gating: on an always-on kitchen tablet the web board polls
 * `GET /events` on a timer, so a server-side read counts "the board was active that day", NOT "a human
 * glanced" — the two aren't separable server-side. So `daysWithGlance` is REPORTED for the founder to judge
 * the daily-glance gate informally, but `verdict` = forward-habit AND parse-accuracy only.
 *
 * The window is the trailing `windowDays` calendar days: `since = now - (windowDays-1) days`, so the day
 * buckets number exactly `windowDays` (fixing a prior off-by-one that let `glanceRate` exceed 1.0). Day
 * bucketing is UTC (`date(received_at)` / `date('now')`); a Jerusalem-day refinement is deferred (a ±1-day
 * midnight drift, negligible for a monthly N=2 gate).
 */
export function computeDogfoodMetrics(
  inbound: Pick<InboundStore, "outcomeCountsSince" | "forwardsByDaySince">,
  metrics: Pick<MetricsStore, "boardReadDaysSince">,
  opts: {
    windowDays: number;
    now: Date;
    fromPhones?: readonly string[];
    thresholds?: Partial<DogfoodThresholds>;
  },
): DogfoodMetricsResponse {
  const { windowDays, now, fromPhones } = opts;
  const t = { ...DEFAULT_DOGFOOD_THRESHOLDS, ...opts.thresholds };
  // Trailing `windowDays` days: back up (windowDays - 1) days so the buckets number exactly windowDays.
  const sinceIso = sqliteUtc(new Date(now.getTime() - Math.max(windowDays - 1, 0) * DAY_MS));

  const byDay = inbound.forwardsByDaySince(sinceIso, fromPhones);
  const total = byDay.reduce((sum, d) => sum + d.count, 0);
  const perDay = windowDays > 0 ? total / windowDays : 0;

  const outcomes = inbound.outcomeCountsSince(sinceIso, fromPhones);
  const parsed = outcomes.parsed ?? 0;
  const rephrase = outcomes.rephrase ?? 0;
  const clarified = outcomes.clarified ?? 0;
  const attempts = parsed + clarified + rephrase; // every family message the bot TRIED to schedule
  const accuracy = attempts > 0 ? parsed / attempts : null;

  const daysWithGlance = metrics.boardReadDaysSince(sinceIso);
  const glanceRate = windowDays > 0 ? Math.min(daysWithGlance / windowDays, 1) : 0;

  const forwardHabit = {
    value: perDay,
    threshold: t.forwardsPerDay,
    pass: perDay >= t.forwardsPerDay,
  };
  const parseAccuracy = {
    value: accuracy,
    threshold: t.parseAccuracy,
    pass: accuracy !== null && accuracy >= t.parseAccuracy,
  };
  // Reported for the founder to judge informally; NOT part of `verdict` (see the doc comment).
  const dailyGlance = {
    value: glanceRate,
    threshold: t.glanceRate,
    pass: glanceRate >= t.glanceRate,
  };
  const verdict = forwardHabit.pass && parseAccuracy.pass ? "go" : "no-go";

  return {
    windowDays,
    forwards: { total, perDay, byDay },
    parse: { parsed, rephrase, clarified, accuracy },
    engagement: { daysWithGlance, glanceRate },
    gates: { forwardHabit, parseAccuracy, dailyGlance },
    verdict,
  };
}
