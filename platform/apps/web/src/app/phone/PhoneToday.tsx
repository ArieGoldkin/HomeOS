import { DayView } from "@features/day-view";
import { useDayEvents, useNow } from "@shared/hooks";

export interface PhoneTodayProps {
  /** The selected day (`YYYY-MM-DD`) from the route's `?date=` search param. */
  dateIso: string;
}

/**
 * The phone "today" screen — the data-connected counterpart to TabletBoard, reusing the same DayView
 * and useDayEvents. Day theme (light), scrollable (the phone is not the no-scroll kiosk). The NowLine
 * shows only when `dateIso` is actually today (useDayEvents returns a null clock otherwise).
 */
export function PhoneToday({ dateIso }: PhoneTodayProps) {
  const now = useNow();
  const { status, timed, untimed, tomorrow, nowTime, moreCount } = useDayEvents(dateIso, now);

  return (
    <DayView
      status={status}
      timed={timed}
      untimed={untimed}
      tomorrow={tomorrow}
      nowTime={nowTime}
      moreCount={moreCount}
    />
  );
}
