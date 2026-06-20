import { ConnectionCard } from "./ConnectionCard";

/**
 * The web Connections screen (web-only surface). Presentational placeholder for Milestone #10
 * (Connect-Google, #111/#112 — unbuilt): lists the integrations with disabled actions. When #10 lands,
 * swap these static cards for the live connection-status hook + connect flow.
 */
export function ConnectionsView() {
  return (
    <div className="flex flex-col gap-4" data-testid="connections-view">
      <h2 className="font-display font-bold text-[20px] text-foreground">חיבורים</h2>
      <p className="text-[14px] text-muted-foreground">
        חברו שירותים כדי שאירועים יגיעו אוטומטית ללוח.
      </p>
      <div className="flex flex-col gap-2">
        <ConnectionCard name="Google Calendar" description="אירועים מהיומן ישירות ללוח" />
        <ConnectionCard name="Gmail" description="זיהוי אירועים ממיילים מהגן ובית הספר" />
      </div>
    </div>
  );
}
