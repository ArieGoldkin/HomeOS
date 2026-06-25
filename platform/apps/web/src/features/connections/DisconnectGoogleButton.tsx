import { type ConnectErrorReason, disconnectGoogle, GoogleConnectError } from "@shared/api";
import { googleStatusQueryKey } from "@shared/hooks";
import { Button, Dialog, Field } from "@shared/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

/** Allowlisted inline Hebrew for each typed disconnect-error reason (same mapping idiom as connect). */
const DISCONNECT_ERROR_HE: Record<ConnectErrorReason, string> = {
  auth: "קוד שגוי",
  rate_limited: "יותר מדי ניסיונות, נסו שוב מאוחר יותר",
  not_configured: "Google לא מוגדר בשרת",
  unknown: "משהו השתבש, נסו שוב",
};

/**
 * #112 — a confirm dialog that DESTROYS the Google connection. Like the connect flow it requires the
 * setup CODE (re-typed to confirm a destroy), held ONLY in local in-memory state and cleared on close —
 * never persisted, never bundled. On confirm it calls `disconnectGoogle(code)` then invalidates the
 * `['google','status']` query so the card re-reads the now-disconnected status.
 */
export function DisconnectGoogleButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
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
      await disconnectGoogle(code);
      await queryClient.invalidateQueries({ queryKey: googleStatusQueryKey });
      handleOpenChange(false);
    } catch (err) {
      const reason: ConnectErrorReason = err instanceof GoogleConnectError ? err.reason : "unknown";
      setError(DISCONNECT_ERROR_HE[reason]);
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => handleOpenChange(true)}
        data-testid="disconnect-google-open"
      >
        נתק
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange} title="ניתוק Google">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className="text-[13px] text-muted-foreground">
            הזינו את קוד ההגדרה כדי לנתק את חשבון ה‑Google. הסנכרון עם היומן והמייל ייפסק.
          </p>
          <Field
            id="google-disconnect-code"
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
            data-testid="disconnect-code-input"
          />
          <Button
            type="submit"
            variant="ink"
            disabled={submitting || code.length === 0}
            className="w-full"
          >
            נתק את החשבון
          </Button>
        </form>
      </Dialog>
    </>
  );
}
