import { WhatsAppIngestion } from "@features/ingestion";
import { ConnectionCard } from "./ConnectionCard";
import { LinkedMembers } from "./LinkedMembers";
import { RecentIngestion } from "./RecentIngestion";
import { WhatsAppChannelCard } from "./WhatsAppChannelCard";

/**
 * The Connections screen (#182) — the single home for how events reach the board: the WhatsApp channel
 * hero, the "how it works" forward→board demo, the recent-ingestion feed (behind the distinct messages
 * token), the linked household members, and the connected-service tiles. Composed in the Modern screen
 * idiom (kicker + display heading + Card sections); the kiosk-era /ingestion and /messages routes are
 * gone — this is the one authenticated surface for all of it.
 */
export function ConnectionsView() {
  return (
    <div className="flex flex-col gap-7" data-testid="connections-view">
      <header>
        <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          ערוצים ומקורות
        </div>
        <h1 className="mt-2 font-display font-extrabold text-[34px] text-[color:var(--ink)] leading-[1.05] tracking-tight">
          מרכז <span className="font-accent font-medium text-primary">החיבורים</span>
        </h1>
        <p className="mt-3 text-[14px] text-muted-foreground">איך אירועים נכנסים ללוח — ומאיפה.</p>
      </header>

      <WhatsAppChannelCard />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WhatsAppIngestion />
        <RecentIngestion />
      </div>

      <LinkedMembers />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-[14.5px] text-[color:var(--ink)]">שירותים מחוברים</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ConnectionCard name="Google Calendar" description="אירועים מהיומן ישירות ללוח" />
          <ConnectionCard name="Gmail" description="זיהוי אירועים ממיילים מהגן ובית הספר" />
        </div>
      </section>
    </div>
  );
}
