import { type ConnectErrorReason, GoogleConnectError, startGoogleConnect } from "@shared/api";
import { Button, Dialog, Field } from "@shared/ui";
import { type FormEvent, useState } from "react";
import { GoogleLogo } from "./GoogleLogo";

/**
 * The inline Hebrew copy for each typed connect-error reason. An ALLOWLISTED lookup — we map the typed
 * `reason` (never a raw status code or a server-authored message) to fixed Hebrew, so a bad/changed server
 * response can't render arbitrary text. `unknown` is the catch-all.
 */
const CONNECT_ERROR_HE: Record<ConnectErrorReason, string> = {
  auth: "קוד שגוי",
  rate_limited: "יותר מדי ניסיונות, נסו שוב מאוחר יותר",
  not_configured: "Google לא מוגדר בשרת",
  unknown: "משהו השתבש, נסו שוב",
};

/**
 * #112 — opens the shared responsive `Dialog` with ONE `dir="ltr"` password Field for the setup code.
 * On submit it exchanges the code for the Google consent URL (`startGoogleConnect`) then navigates the
 * browser there (`window.location.assign`). The setup CODE lives ONLY in this component's local state — a
 * short-lived in-memory value cleared on dialog close; it is NEVER written to localStorage/sessionStorage
 * or any persisted store, and is NEVER bundled (it's the user's runtime input, not an env var). Typed api
 * errors map to allowlisted inline Hebrew (wrong code / too many / server dark).
 */
export function ConnectGoogleButton() {
  const [open, setOpen] = useState(false);
  // The setup code — in-memory only, never persisted. Cleared whenever the dialog closes.
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Clear the short-lived secret + transient UI state on close — nothing about the code survives.
      setCode("");
      setError(null);
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { url } = await startGoogleConnect(code);
      window.location.assign(url);
    } catch (err) {
      const reason = err instanceof GoogleConnectError ? err.reason : "unknown";
      setError(CONNECT_ERROR_HE[reason]);
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="ink"
        className="w-full"
        onClick={() => handleOpenChange(true)}
        data-testid="connect-google-open"
      >
        <GoogleLogo size={18} />
        חבר Google
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange} title="חיבור Google">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className="text-[13px] text-muted-foreground">
            הזינו את קוד ההגדרה כדי לחבר את חשבון ה‑Google של המשפחה.
          </p>
          <Field
            id="google-setup-code"
            label="קוד הגדרה"
            type="password"
            dir="ltr"
            autoComplete="off"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            error={error ?? undefined}
            data-testid="setup-code-input"
          />
          <Button type="submit" disabled={submitting || code.length === 0} className="w-full">
            המשך לחיבור
          </Button>
        </form>
      </Dialog>
    </>
  );
}
