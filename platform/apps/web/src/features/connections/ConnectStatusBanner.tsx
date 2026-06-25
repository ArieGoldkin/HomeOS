import type { ConnectOutcome } from "@homeos/shared";
import { useEffect } from "react";

/**
 * #112 — the allowlisted outcome → Hebrew copy + tone. The router already validated `?status=` against
 * the shared `connectOutcomeSchema`, so the value reaching here is ALWAYS one of these keys; we map it
 * through this record and NEVER render the raw param. `connected` is the only success; every other outcome
 * is an error/attention banner.
 */
const OUTCOME_META: Record<ConnectOutcome, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "החשבון של Google חובר בהצלחה" },
  cancelled: { tone: "error", text: "החיבור בוטל — לא חוברנו ל‑Google" },
  no_refresh: { tone: "error", text: "החיבור לא הושלם — נסו שוב ואשרו את כל ההרשאות" },
  bad_scope: { tone: "error", text: "חסרות הרשאות — נסו שוב ואשרו את כל ההרשאות" },
  bad_state: { tone: "error", text: "החיבור פג — נסו שוב מההתחלה" },
  bad_account: { tone: "error", text: "חשבון Google לא מורשה — השתמשו בחשבון המשפחה" },
  error: { tone: "error", text: "משהו השתבש בחיבור — נסו שוב" },
};

export interface ConnectStatusBannerProps {
  /** The validated outcome from `?status=` (already allowlisted by the router). */
  status: ConnectOutcome;
  /** Called once after the banner mounts so the parent can strip the param from the URL. */
  onShown: () => void;
}

/**
 * The post-callback banner for the Connect-Google flow. Renders a success/error message looked up by the
 * already-validated outcome enum, then calls `onShown` (on mount) so the URL param is stripped — the
 * message stays visible for this render, but a refresh/back won't re-show it.
 */
export function ConnectStatusBanner({ status, onShown }: ConnectStatusBannerProps) {
  // Defensive: if an out-of-enum value ever reaches here (it shouldn't — the router validates), strip the
  // param and render nothing rather than crash on a missing meta entry.
  const meta = OUTCOME_META[status] as (typeof OUTCOME_META)[ConnectOutcome] | undefined;

  // Strip the param after the banner has been rendered for this navigation.
  useEffect(() => {
    onShown();
  }, [onShown]);

  if (!meta) return null;
  const isSuccess = meta.tone === "success";

  return (
    <div
      role="status"
      data-testid="connect-status-banner"
      className={
        isSuccess
          ? "rounded-[var(--radius)] border border-wa-green/30 bg-wa-green/10 px-4 py-3 text-[14px] text-wa-green"
          : "rounded-[var(--radius)] border border-coral/30 bg-coral/10 px-4 py-3 text-[14px] text-coral"
      }
    >
      {meta.text}
    </div>
  );
}
