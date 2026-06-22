import type { SavedEvent, SavedEventSource } from "@homeos/shared";
import type { ReactNode } from "react";

/**
 * #153 — the event-detail body: the ORIGINAL forwarded text + a human source label + when it was
 * captured. Pure/presentational (takes a {@link SavedEvent} directly, like EventCard). Hosted ONLY in the
 * phone Sheet / web Modal — NEVER on the no-auth tablet kiosk, because `source_text` is other people's
 * words (Meta single-purpose + outsider privacy, the #153 security line). The kiosk-exclusion is enforced
 * one level up: EventCard is only interactive when given `onOpenDetail`, which TabletBoard never passes.
 */

// Full provenance labels (the detail names every source; ProviderBadge stays gmail/gcal-only). Latin runs
// are wrapped in <bdi> so the Hebrew↔Latin boundary can't flip under bidi reordering in the RTL label.
const SOURCE_LABEL: Record<SavedEventSource, ReactNode> = {
  whatsapp: "וואטסאפ",
  web: "הוספה ידנית",
  gmail: <bdi>Gmail</bdi>,
  gcal: (
    <>
      יומן <bdi>Google</bdi>
    </>
  ),
};

// created_at is an ISO-8601 UTC string; render it as the Asia/Jerusalem wall-clock in Hebrew.
const CREATED_FMT = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  dateStyle: "long",
  timeStyle: "short",
});

export interface EventDetailProps {
  event: SavedEvent;
}

export function EventDetail({ event }: EventDetailProps) {
  const text = event.source_text?.trim();
  const created = event.created_at ? CREATED_FMT.format(new Date(event.created_at)) : null;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-[13px] font-medium text-muted-foreground">ההודעה המקורית</h3>
        {text ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">{text}</p>
        ) : (
          <p className="text-[15px] text-muted-foreground">— אין טקסט מקורי</p>
        )}
      </section>

      {(event.source || created) && (
        <dl className="flex flex-col gap-1.5 text-[13px]">
          {event.source && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">מקור:</dt>
              <dd className="text-foreground">{SOURCE_LABEL[event.source]}</dd>
            </div>
          )}
          {created && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">נוצר:</dt>
              <dd className="text-foreground">{created}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
