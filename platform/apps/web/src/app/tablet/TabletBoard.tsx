import { DayView, type DayViewStatus } from "@features/day-view";
import { useEvents, useNow } from "@shared/hooks";
import {
  addDaysIso,
  curateTimed,
  jerusalemHhmm,
  jerusalemTodayIso,
  partitionDay,
} from "@shared/lib";
import { TabletShell } from "./TabletShell";

/**
 * The first complete surface: the ambient kitchen-tablet board. The ONLY data-connected piece —
 * it wires useEvents (30s refetch) + useNow (minute clock), partitions the flat /events list into
 * today/tomorrow, curates the timed events to what fits (no scroll), and renders the chrome + DayView.
 * Glance-only: no add/edit/nav. Runs the night theme + night assignee colors.
 */
export function TabletBoard() {
  const now = useNow();
  const { data, isLoading, isError } = useEvents();

  const today = jerusalemTodayIso(now);
  const tomorrowIso = addDaysIso(today, 1);
  const nowTime = jerusalemHhmm(now);

  const { timed, untimed, tomorrow: peek } = partitionDay(data ?? [], today, tomorrowIso);
  const { shown, moreCount } = curateTimed(timed, nowTime);
  const status: DayViewStatus = isLoading ? "loading" : isError ? "error" : "ready";

  return (
    <TabletShell now={now}>
      <DayView
        status={status}
        timed={shown}
        untimed={untimed}
        tomorrow={peek}
        nowTime={nowTime}
        moreCount={moreCount}
        night
      />
    </TabletShell>
  );
}
