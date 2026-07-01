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
  /** share of window days with ≥1 board glance. */
  glanceRate: number;
}

export const DEFAULT_DOGFOOD_THRESHOLDS: DogfoodThresholds = {
  forwardsPerDay: 1,
  parseAccuracy: 0.8,
  glanceRate: 0.7,
};

/**
 * #26 — compute the dogfood-month validation metrics + go/no-go from the existing pipeline (counts only, no
 * PII). Pure over the two injected stores + `now`: forward volume/day, parse-outcome dispositions
 * (accuracy = parsed ÷ (parsed + rephrase)), and board-glance days across the last `windowDays`. The verdict
 * is `go` iff ALL THREE gates pass; a gate whose value can't be computed yet (null accuracy) never passes.
 */
export function computeDogfoodMetrics(
  inbound: Pick<InboundStore, "outcomeCountsSince" | "forwardsByDaySince">,
  metrics: Pick<MetricsStore, "boardReadDaysSince">,
  opts: { windowDays: number; now: Date; thresholds?: Partial<DogfoodThresholds> },
): DogfoodMetricsResponse {
  const { windowDays, now } = opts;
  const t = { ...DEFAULT_DOGFOOD_THRESHOLDS, ...opts.thresholds };
  const sinceIso = sqliteUtc(new Date(now.getTime() - windowDays * DAY_MS));

  const byDay = inbound.forwardsByDaySince(sinceIso);
  const total = byDay.reduce((sum, d) => sum + d.count, 0);
  const perDay = windowDays > 0 ? total / windowDays : 0;

  const outcomes = inbound.outcomeCountsSince(sinceIso);
  const parsed = outcomes.parsed ?? 0;
  const rephrase = outcomes.rephrase ?? 0;
  const clarified = outcomes.clarified ?? 0;
  const attempts = parsed + rephrase; // the two pure parse outcomes: a hit vs a "please rephrase" miss
  const accuracy = attempts > 0 ? parsed / attempts : null;

  const daysWithGlance = metrics.boardReadDaysSince(sinceIso);
  const glanceRate = windowDays > 0 ? daysWithGlance / windowDays : 0;

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
  const dailyGlance = {
    value: glanceRate,
    threshold: t.glanceRate,
    pass: glanceRate >= t.glanceRate,
  };
  const verdict = forwardHabit.pass && parseAccuracy.pass && dailyGlance.pass ? "go" : "no-go";

  return {
    windowDays,
    forwards: { total, perDay, byDay },
    parse: { parsed, rephrase, clarified, accuracy },
    engagement: { daysWithGlance, glanceRate },
    gates: { forwardHabit, parseAccuracy, dailyGlance },
    verdict,
  };
}
