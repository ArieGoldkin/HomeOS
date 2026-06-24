import type { SavedEvent } from "@homeos/shared";

export interface DayPeekItem {
  time: string | null;
  title: string;
}

export interface DayPartition {
  /** Today's timed events, sorted ascending — feed the TimeSpine. */
  timed: SavedEvent[];
  /** Today's untimed events — feed the AnytimeSidebar. */
  untimed: SavedEvent[];
  /** Tomorrow's events as quiet peek rows (untimed sort last). */
  tomorrow: DayPeekItem[];
}

/** Split the flat `/events` list into today-timed / today-untimed / tomorrow-peek buckets. */
export function partitionDay(
  events: SavedEvent[],
  todayIso: string,
  tomorrowIso: string,
): DayPartition {
  const today = events.filter((e) => e.date_iso === todayIso);
  const timed = today
    .filter((e) => e.time != null)
    .sort((a, b) => (a.time as string).localeCompare(b.time as string));
  const untimed = today.filter((e) => e.time == null);
  const tomorrow = events
    .filter((e) => e.date_iso === tomorrowIso)
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"))
    .map((e) => ({ time: e.time, title: e.title_he }));
  return { timed, untimed, tomorrow };
}

/**
 * #20 — why an untimed item ranks where it does (the "explainable" signal). `overdue` = an open TASK
 * carried forward from a past day; `today` = an open item for the selected day; `done` = completed (sunk).
 * The bucket IS the primary sort key, so exposing it is free — a future UI can render an "overdue" chip
 * without re-deriving anything.
 */
export type UntimedBucket = "overdue" | "today" | "done";

export interface RankedUntimedItem {
  event: SavedEvent;
  bucket: UntimedBucket;
}

/**
 * #20 — deterministic ordering of the day's untimed "anytime" list. NOT a scoring engine: a fixed rule
 * the board renders top-first. Order = overdue-open tasks (carried forward, oldest first) → the selected
 * day's open items → done (sunk). Pure and time-relative only via the injected `todayIso` (anchor the
 * caller computes in Asia/Jerusalem) — no clock here, so it's trivially unit-testable.
 *
 * Carry-forward is deliberately narrow: only `kind === "task"` rows that are still open and dated BEFORE
 * today, and ONLY when the selected day IS today (a past/future day shows just its own items). Events and
 * reminders never carry (a past meeting isn't a to-do); a past task that's already done never carries.
 */
export function prioritizeUntimed(
  todayUntimed: SavedEvent[],
  allEvents: SavedEvent[],
  selectedIso: string,
  todayIso: string,
): RankedUntimedItem[] {
  const isDone = (e: SavedEvent) => e.status === "done";
  const byTitle = (a: SavedEvent, b: SavedEvent) => a.title_he.localeCompare(b.title_he);

  const overdue =
    selectedIso === todayIso
      ? allEvents
          .filter((e) => e.kind === "task" && !isDone(e) && e.date_iso < todayIso)
          .sort((a, b) => a.date_iso.localeCompare(b.date_iso) || byTitle(a, b))
      : [];
  const open = todayUntimed.filter((e) => !isDone(e));
  const done = todayUntimed.filter(isDone).sort(byTitle);

  return [
    ...overdue.map((event): RankedUntimedItem => ({ event, bucket: "overdue" })),
    ...open.map((event): RankedUntimedItem => ({ event, bucket: "today" })),
    ...done.map((event): RankedUntimedItem => ({ event, bucket: "done" })),
  ];
}

export interface CuratedTimed {
  shown: SavedEvent[];
  moreCount: number;
}

/**
 * The tablet never scrolls — it curates. Show a window of up to `max` timed events around now (one past
 * event for context + the upcoming ones) and report how many are hidden, for a "+N more" cue.
 */
export function curateTimed(timed: SavedEvent[], nowHhmm: string, max = 5): CuratedTimed {
  if (timed.length <= max) return { shown: timed, moreCount: 0 };
  const nowIdx = timed.findIndex((e) => (e.time as string) >= nowHhmm);
  const anchor = nowIdx === -1 ? timed.length : nowIdx;
  const start = Math.min(Math.max(0, anchor - 1), timed.length - max);
  const shown = timed.slice(start, start + max);
  return { shown, moreCount: timed.length - shown.length };
}
