import { DayView } from "@features/day-view";
import type { SavedEvent } from "@homeos/shared";
import { useDayEvents, useNow } from "@shared/hooks";

export interface PhoneTodayProps {
  /** The selected day (`YYYY-MM-DD`) from the route's `?date=` search param. */
  dateIso: string;
  /** #153 — when set, the day's cards open the detail drawer (the screen owns the host + selected state). */
  onOpenDetail?: (event: SavedEvent) => void;
}

/**
 * The phone "today" screen — the data-connected counterpart to TabletBoard, reusing the same DayView
 * and useDayEvents. Day theme (light), scrollable (the phone is not the no-scroll kiosk). The NowLine
 * shows only when `dateIso` is actually today (useDayEvents returns a null clock otherwise).
 */
export function PhoneToday({ dateIso, onOpenDetail }: PhoneTodayProps) {
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
      onOpenDetail={onOpenDetail}
    />
  );
}
