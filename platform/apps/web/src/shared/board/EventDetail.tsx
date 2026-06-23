import type { SavedEvent, SavedEventSource } from "@homeos/shared";
import type { ReactNode } from "react";

/**
 * The event-detail body: the ORIGINAL forwarded text + a human source label + when it was captured.
 * Pure/presentational (takes a {@link SavedEvent} directly, like EventCard). Hosted in the responsive
 * detail Dialog. NOTE (#184): `source_text` (which can be other people's words) now renders in the single
 * AUTHENTICATED app — the prior #153 exclusion, which kept it off the retired ambient surface, is
 * consciously relaxed since that surface no longer exists.
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
  // source_text is a required field in the contract → no optional-chain; .trim() still catches a
  // whitespace-only body (web/manual adds) and falls back to the placeholder.
  const text = event.source_text.trim();
  const created = event.created_at ? CREATED_FMT.format(new Date(event.created_at)) : null;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-[13px] font-medium text-muted-foreground">ההודעה המקורית</h3>
        {text ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[color:var(--ink)]">
            {text}
          </p>
        ) : (
          <p className="text-[15px] text-muted-foreground">אין טקסט מקורי</p>
        )}
      </section>

      {(event.source || created) && (
        <dl className="flex flex-col gap-1.5 text-[13px]">
          {event.source && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">מקור:</dt>
              <dd className="text-[color:var(--ink)]">{SOURCE_LABEL[event.source]}</dd>
            </div>
          )}
          {created && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">נוצר:</dt>
              {/* bidi-isolate: the date carries Latin digits inside Hebrew → keep it from reordering. */}
              <dd className="text-[color:var(--ink)]">
                <bdi>{created}</bdi>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
