import type { SavedEvent } from "@homeos/shared";
import { useCallback, useState } from "react";

/**
 * Selected-event state for the detail drawer, owned at the screen level. `openDetail` is the handler
 * threaded down to EventCard via `onOpenDetail`; `closeDetail` clears it. The screen hosts the result in
 * the responsive {@link EventDetailDrawer} (sheet on phones, modal ≥md).
 */
export function useEventDetail() {
  const [selected, setSelected] = useState<SavedEvent | null>(null);
  const openDetail = useCallback((event: SavedEvent) => setSelected(event), []);
  const closeDetail = useCallback(() => setSelected(null), []);
  return { selected, openDetail, closeDetail };
}
