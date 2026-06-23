import type { SavedEvent } from "@homeos/shared";
import { EventDetail } from "@shared/board";
import { Dialog } from "@shared/ui";

export interface EventDetailDrawerProps {
  /** The event whose detail to show, or `null` when the drawer is closed. */
  event: SavedEvent | null;
  /** Called when the drawer should close (overlay click / ESC / close button). */
  onClose: () => void;
}

const TITLE = "פרטי האירוע";

/**
 * Hosts {@link EventDetail} (the original text + source + created_at) in the responsive {@link Dialog}
 * (#184 — bottom sheet on phones, centered modal ≥md). One host, no `surface` prop: the drawer is driven
 * purely by `event` (non-null ⇒ open) and nulls it on close.
 */
export function EventDetailDrawer({ event, onClose }: EventDetailDrawerProps) {
  const open = event != null;
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={TITLE}>
      {event ? <EventDetail event={event} /> : null}
    </Dialog>
  );
}
