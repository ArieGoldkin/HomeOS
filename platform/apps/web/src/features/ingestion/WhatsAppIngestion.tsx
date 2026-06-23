import type { SavedEvent } from "@homeos/shared";
import { EventCard } from "@shared/board";
import { Card } from "@shared/ui";
import { WhatsAppBubble } from "./WhatsAppBubble";

/** The board event the forwarded message becomes — the "→ board" half of the demo. */
const PREVIEW: SavedEvent = {
  id: 1,
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-18",
  time: "17:00",
  location: "גן רימון",
  assignee: "אמא",
  recurrence: null,
  source_text: "תזכורת: אסיפת הורים מחר ב-17:00 בגן רימון",
  source_provider: null,
};

/**
 * The "How it works" card (#182, re-skin of #98) — embeddable inside the Connections screen: forward a
 * Hebrew WhatsApp message → it becomes a board event. A mock WhatsApp chat (literal WA colors via
 * WhatsAppBubble — never recolored) flows into the resulting EventCard, with the forward-only privacy
 * footnote kept verbatim (the red line). Presentational only — no data fetching.
 */
export function WhatsAppIngestion() {
  return (
    <Card className="flex flex-col gap-4 p-[18px]" data-testid="wa-ingestion">
      <div>
        <span className="font-semibold text-[14.5px] text-[color:var(--ink)]">איך זה עובד</span>
        <p className="mt-1 text-[13px] text-muted-foreground">
          מעבירים הודעה בוואטסאפ — היא הופכת לאירוע על הלוח.
        </p>
      </div>

      {/* Mock WhatsApp chat (literal WA palette via WhatsAppBubble) */}
      <div
        className="flex flex-col gap-2 rounded-[var(--radius)] p-4"
        style={{ background: "#0b141a" }}
      >
        <WhatsAppBubble variant="user">↪ תזכורת: אסיפת הורים מחר ב-17:00 בגן רימון</WhatsAppBubble>
        <WhatsAppBubble variant="bot" delayMs={150}>
          הוספתי ליומן ✓ אסיפת הורים · מחר · 17:00 — גן רימון
        </WhatsAppBubble>
      </div>

      {/* → the resulting board event */}
      <div className="flex flex-col gap-2">
        <p className="text-center text-[12.5px] text-muted-foreground">↓ וזה מה שנוחת על הלוח</p>
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-card-muted p-4">
          <EventCard event={PREVIEW} surface="web" />
        </div>
      </div>

      <p
        className="text-[12px] text-muted-foreground leading-relaxed"
        data-testid="privacy-footnote"
      >
        🔒 רק הודעות שאתם מעבירים יזום ל-HomeOS נקראות — שום צ'אט אחר לא נסרק. זה קו פרטיות אדום.
      </p>
    </Card>
  );
}
