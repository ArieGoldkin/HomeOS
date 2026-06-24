import type { SavedEvent } from "@homeos/shared";
import {
  addDaysIso,
  curateTimed,
  type DayPeekItem,
  jerusalemHhmm,
  jerusalemTodayIso,
  partitionDay,
  prioritizeUntimed,
} from "@shared/lib";
import { useEvents } from "./use-events";

export type DayStatus = "loading" | "error" | "ready";

export interface DayEvents {
  status: DayStatus;
  /** The day's timed events, already curated to what fits (the board never scrolls). */
  timed: SavedEvent[];
  /** The day's untimed events. */
  untimed: SavedEvent[];
  /** The next day's events as quiet peek rows. */
  tomorrow: DayPeekItem[];
  /** `HH:MM` when `dateIso` is today (positions the NowLine); `null` on any other day. */
  nowTime: string | null;
  /** How many timed events were curated away (drives the "+N more" cue). */
  moreCount: number;
}

/**
 * The selected day's board, derived from the live `/events` list. Shared by the tablet board and the
 * phone "today" screen so the partition + curate logic lives in exactly one place. The NowLine clock
 * is exposed only when `dateIso` is actually today — a past/future day has no "now", so it curates
 * from the start of the day instead.
 */
export function useDayEvents(dateIso: string, now: Date): DayEvents {
  const { data, isLoading, isError } = useEvents();

  const todayIso = jerusalemTodayIso(now);
  const isToday = dateIso === todayIso;
  const nowTime = isToday ? jerusalemHhmm(now) : null;
  const tomorrowIso = addDaysIso(dateIso, 1);

  const { timed, untimed, tomorrow } = partitionDay(data ?? [], dateIso, tomorrowIso);
  // #20 — rank the anytime list: overdue open tasks carried forward (today view only), then the day's
  // open items, then done (sunk). The bucket tag stays inside prioritizeUntimed (tested there); the UI
  // consumes the flat ordered events for now.
  const rankedUntimed = prioritizeUntimed(untimed, data ?? [], dateIso, todayIso);
  const { shown, moreCount } = curateTimed(timed, nowTime ?? "00:00");
  const status: DayStatus = isLoading ? "loading" : isError ? "error" : "ready";

  return {
    status,
    timed: shown,
    untimed: rankedUntimed.map((r) => r.event),
    tomorrow,
    nowTime,
    moreCount,
  };
}
