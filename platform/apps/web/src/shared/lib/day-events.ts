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
