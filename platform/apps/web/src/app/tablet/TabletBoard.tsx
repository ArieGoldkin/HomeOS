import { DayView } from "@features/day-view";
import { useDayEvents, useNow } from "@shared/hooks";
import { jerusalemTodayIso } from "@shared/lib";
import { TabletShell } from "./TabletShell";

/**
 * The first complete surface: the ambient kitchen-tablet board. The ONLY data-connected piece on the
 * tablet — it wires useNow (minute clock) + useDayEvents (today's curated board over the 30s-refetched
 * /events) and renders the chrome + DayView. Glance-only: no add/edit/nav. Night theme + night colors.
 */
export function TabletBoard() {
  const now = useNow();
  const today = jerusalemTodayIso(now);
  const { status, timed, untimed, tomorrow, nowTime, moreCount } = useDayEvents(today, now);

  return (
    <TabletShell now={now}>
      <DayView
        status={status}
        timed={timed}
        untimed={untimed}
        tomorrow={tomorrow}
        nowTime={nowTime}
        moreCount={moreCount}
      />
    </TabletShell>
  );
}
