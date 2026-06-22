import type { SavedEvent } from "@homeos/shared";
import { useCallback, useState } from "react";

/**
 * #153 — selected-event state for the detail drawer, owned at the screen/shell level (NOT inside the
 * shared DayView, which the kiosk also renders). `openDetail` is the handler threaded down to EventCard
 * via `onOpenDetail`; `closeDetail` clears it. Phone screens host the result in a Sheet, web in a Modal.
 */
export function useEventDetail() {
  const [selected, setSelected] = useState<SavedEvent | null>(null);
  const openDetail = useCallback((event: SavedEvent) => setSelected(event), []);
  const closeDetail = useCallback(() => setSelected(null), []);
  return { selected, openDetail, closeDetail };
}
