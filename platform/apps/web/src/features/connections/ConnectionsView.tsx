import { WhatsAppIngestion } from "@features/ingestion";
import type { ConnectOutcome } from "@homeos/shared";
import { ConnectStatusBanner } from "./ConnectStatusBanner";
import { GoogleConnectionCard } from "./GoogleConnectionCard";
import { InviteMembers } from "./InviteMembers";
import { LinkedMembers } from "./LinkedMembers";
import { LinkedPhones } from "./LinkedPhones";
import { RecentIngestion } from "./RecentIngestion";
import { WhatsAppChannelCard } from "./WhatsAppChannelCard";

export interface ConnectionsViewProps {
  /**
   * #112 — the validated OAuth-callback outcome from `?status=` (already allowlisted by the router), shown
   * as a one-time success/error banner. Undefined ⇒ no banner.
   */
  connectStatus?: ConnectOutcome;
  /** Called once after the banner is shown so the router can strip `?status=` from the URL. */
  onDismissStatus?: () => void;
}

/**
 * The Connections screen (#182) — the single home for how events reach the board: the WhatsApp channel
 * hero, the "how it works" forward→board demo, the recent-ingestion feed (behind the distinct messages
 * token), the linked household members, and the connected-service card. Composed in the Modern screen
 * idiom (kicker + display heading + Card sections); the legacy /ingestion and /messages routes are
 * gone — this is the one app surface for all of it.
 *
 * #112: the two static Google Calendar + Gmail tiles are replaced by the single real
 * {@link GoogleConnectionCard} (one card covers both, its scopes spanning Calendar + Gmail). After a
 * self-serve OAuth round-trip the screen shows a one-time banner mapped from the `?status=` outcome.
 */
export function ConnectionsView({ connectStatus, onDismissStatus }: ConnectionsViewProps) {
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

      {connectStatus && (
        <ConnectStatusBanner status={connectStatus} onShown={onDismissStatus ?? (() => {})} />
      )}

      <WhatsAppChannelCard />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WhatsAppIngestion />
        <RecentIngestion />
      </div>

      <LinkedMembers />

      {/* #250 — owner-only self-serve invite admin (renders only for an owner; capability-gated). */}
      <InviteMembers />

      {/* #262 — owner-only WhatsApp-sender revocation (renders only for an owner; capability-gated). */}
      <LinkedPhones />

      <GoogleConnectionCard />
    </div>
  );
}
