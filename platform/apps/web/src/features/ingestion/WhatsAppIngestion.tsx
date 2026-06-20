import type { SavedEvent } from "@homeos/shared";
import { EventCard } from "@shared/board";
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
 * Educational "how it works" surface: forward a Hebrew WhatsApp message → it becomes a board event.
 * Shows a mock WhatsApp chat (user-forwarded message + bot confirmation, in literal WA colors) flowing
 * into the resulting EventCard, plus the privacy footnote (forward-only — no other chats are read).
 * Presentational only — no data fetching.
 */
export function WhatsAppIngestion() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6" data-testid="wa-ingestion">
      <header className="text-center">
        <h1 className="font-display font-bold text-[22px] text-foreground">איך זה עובד</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          מעבירים הודעה בוואטסאפ — היא הופכת לאירוע על הלוח.
        </p>
      </header>

      {/* Mock WhatsApp chat (literal WA palette via WhatsAppBubble) */}
      <div className="flex flex-col gap-2 rounded-[20px] p-4" style={{ background: "#0b141a" }}>
        <WhatsAppBubble variant="user">↪ תזכורת: אסיפת הורים מחר ב-17:00 בגן רימון</WhatsAppBubble>
        <WhatsAppBubble variant="bot" delayMs={150}>
          הוספתי ליומן ✓ אסיפת הורים · מחר · 17:00 — גן רימון
        </WhatsAppBubble>
      </div>

      {/* → the resulting board event */}
      <div className="flex flex-col gap-2">
        <p className="text-center text-[13px] text-muted-foreground">↓ וזה מה שנוחת על הלוח</p>
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <EventCard event={PREVIEW} surface="web" />
        </div>
      </div>

      <p
        className="text-[12px] text-muted-foreground leading-relaxed"
        data-testid="privacy-footnote"
      >
        🔒 רק הודעות שאתם מעבירים יזום ל-HomeOS נקראות — שום צ'אט אחר לא נסרק. זה קו פרטיות אדום.
      </p>
    </div>
  );
}
