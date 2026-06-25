import { GoogleNotConfiguredError } from "@shared/api";
import { useConnectionStatus } from "@shared/hooks";
import { Button, Card, SectionLabel, Skeleton } from "@shared/ui";
import { ConnectGoogleButton } from "./ConnectGoogleButton";
import { DisconnectGoogleButton } from "./DisconnectGoogleButton";
import { GoogleLogo } from "./GoogleLogo";

/**
 * Friendly labels for the granted OAuth scopes (Calendar + Gmail) — an allowlisted lookup so an unexpected
 * scope string falls back to its tail segment rather than rendering raw. Shown `dir="ltr"` (the scope URLs
 * are latin) in a friendly Hebrew-adjacent form.
 */
const SCOPE_LABELS: Record<string, string> = {
  "https://www.googleapis.com/auth/calendar": "יומן Google",
  "https://www.googleapis.com/auth/calendar.events": "אירועי יומן",
  "https://www.googleapis.com/auth/calendar.readonly": "יומן (קריאה)",
  "https://www.googleapis.com/auth/gmail.readonly": "Gmail (קריאה)",
  "https://www.googleapis.com/auth/gmail.modify": "Gmail",
};

function friendlyScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope.split("/").pop() ?? scope;
}

// he-IL, Asia/Jerusalem — the access-token expiry line ("פג תוקף …").
const expiresFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** The shared header row: the Google G mark (never rtl-flipped) + the service name. */
function CardHeader() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary">
        <GoogleLogo size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[15px] text-[color:var(--ink)]">Google</p>
        <p className="text-[13px] text-muted-foreground">יומן ומייל — אירועים ישירות ללוח</p>
      </div>
    </div>
  );
}

/**
 * #112 — the ONE real Google connection card. One Google card represents the whole connection (its scopes
 * cover Calendar + Gmail). Consumes {@link useConnectionStatus} and renders five states:
 * LOADING (skeletons), DARK/503 (non-actionable "לא מוגדר"), ERROR (retry), CONNECTED (green dot, scopes,
 * expiry, "נתק"), and NOT-CONNECTED (muted, "חבר Google"). RTL throughout via logical props; the scopes
 * line is `dir="ltr"` and the G mark is never flipped.
 */
export function GoogleConnectionCard() {
  const { data, isLoading, isError, error, refetch } = useConnectionStatus();

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>שירותים מחוברים</SectionLabel>
      <Card className="flex flex-col gap-4 p-[18px]" data-testid="google-connection-card">
        <CardHeader />
        {isLoading && <LoadingState />}
        {!isLoading && isError && error instanceof GoogleNotConfiguredError && <DarkState />}
        {!isLoading && isError && !(error instanceof GoogleNotConfiguredError) && (
          <ErrorState onRetry={() => refetch()} />
        )}
        {!isLoading && !isError && data?.connected === true && (
          <ConnectedState scopes={data.scopes} expiresAt={data.expiresAt} />
        )}
        {!isLoading && !isError && data?.connected === false && <NotConnectedState />}
      </Card>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-2" data-testid="google-loading">
      <Skeleton variant="line" className="w-2/3" />
      <Skeleton variant="line" className="w-1/2" />
    </div>
  );
}

function DarkState() {
  return (
    <p className="text-[13px] text-muted-foreground" data-testid="google-dark">
      Google לא מוגדר בשרת — חיבור עצמי אינו זמין כרגע.
    </p>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3" data-testid="google-error">
      <p className="text-[13px] text-coral" role="alert">
        לא ניתן לבדוק את מצב החיבור
      </p>
      <Button variant="ghost" onClick={onRetry}>
        נסו שוב
      </Button>
    </div>
  );
}

function ConnectedState({ scopes, expiresAt }: { scopes: string[]; expiresAt: string }) {
  // The schema only guarantees a string, so guard a malformed expiry rather than render "Invalid Date".
  const expiryDate = new Date(expiresAt);
  const expires = Number.isNaN(expiryDate.getTime()) ? null : expiresFmt.format(expiryDate);
  return (
    <div className="flex flex-col gap-3" data-testid="google-connected">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 font-medium text-[13px] text-wa-green">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-wa-green"
            data-testid="status-dot"
          />
          מחובר
        </span>
        <DisconnectGoogleButton />
      </div>
      <p
        dir="ltr"
        className="text-start text-[12px] text-muted-foreground"
        data-testid="google-scopes"
      >
        {scopes.map(friendlyScope).join(" · ")}
      </p>
      {expires && <p className="text-[12px] text-muted-foreground">פג תוקף הגישה: {expires}</p>}
    </div>
  );
}

function NotConnectedState() {
  return (
    <div className="flex flex-col gap-3" data-testid="google-not-connected">
      <p className="text-[13px] text-muted-foreground">לא מחובר</p>
      <ConnectGoogleButton />
    </div>
  );
}
