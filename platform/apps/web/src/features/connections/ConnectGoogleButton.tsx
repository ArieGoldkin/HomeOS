import { type ConnectErrorReason, GoogleConnectError, startGoogleConnect } from "@shared/api";
import { Button } from "@shared/ui";
import { useState } from "react";
import { GoogleLogo } from "./GoogleLogo";

/**
 * The inline Hebrew copy for each typed connect-error reason. An ALLOWLISTED lookup — we map the typed
 * `reason` (never a raw status code or a server-authored message) to fixed Hebrew, so a bad/changed server
 * response can't render arbitrary text. `unknown` is the catch-all.
 */
const CONNECT_ERROR_HE: Record<ConnectErrorReason, string> = {
  auth: "ההתחברות פגה, התחברו מחדש",
  rate_limited: "יותר מדי ניסיונות, נסו שוב מאוחר יותר",
  not_configured: "Google לא מוגדר בשרת",
  unknown: "משהו השתבש, נסו שוב",
};

/**
 * #231 — a plain "Connect Google" button. The connect mutation is now SESSION-gated (the Supabase cookie
 * rides the request like the status read), so there's no setup CODE to type: clicking exchanges the
 * logged-in session for the Google consent URL (`startGoogleConnect`) and navigates the browser there
 * (`window.location.assign`). A typed api error maps to allowlisted inline Hebrew (no session / too many /
 * server dark).
 */
export function ConnectGoogleButton() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConnect() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { url } = await startGoogleConnect();
      window.location.assign(url);
    } catch (err) {
      const reason: ConnectErrorReason = err instanceof GoogleConnectError ? err.reason : "unknown";
      setError(CONNECT_ERROR_HE[reason]);
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="ink"
        className="w-full"
        onClick={handleConnect}
        disabled={submitting}
        data-testid="connect-google-open"
      >
        <GoogleLogo size={18} />
        חבר Google
      </Button>
      {error ? (
        <p
          role="alert"
          className="mt-2 text-[13px] text-red-600"
          data-testid="connect-google-error"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
