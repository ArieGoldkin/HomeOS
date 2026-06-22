import type { SavedEvent } from "@homeos/shared";
import { EventDetail } from "@shared/board";
import { Modal, Sheet } from "@shared/ui";

export interface EventDetailDrawerProps {
  /** The event whose detail to show, or `null` when the drawer is closed. */
  event: SavedEvent | null;
  /** Called when the drawer should close (overlay click / ESC / close button). */
  onClose: () => void;
  /** Surface host: phone → bottom `Sheet`, web → centered `Modal` (same controlled API). */
  surface: "phone" | "web";
}

const TITLE = "פרטי האירוע";

/**
 * #153 — hosts {@link EventDetail} (the original text + source + created_at) in the surface-appropriate
 * controlled dialog. PHONE/WEB ONLY — there is no tablet variant, which is the kiosk-exclusion at the
 * host level (and EventCard is inert on the kiosk anyway, since TabletBoard never passes `onOpenDetail`).
 */
export function EventDetailDrawer({ event, onClose, surface }: EventDetailDrawerProps) {
  const open = event != null;
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  const body = event ? <EventDetail event={event} /> : null;

  if (surface === "phone") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={TITLE}>
        {body}
      </Sheet>
    );
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={TITLE}>
      {body}
    </Modal>
  );
}
