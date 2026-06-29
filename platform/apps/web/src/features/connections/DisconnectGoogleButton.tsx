import { type ConnectErrorReason, disconnectGoogle, GoogleConnectError } from "@shared/api";
import { googleStatusQueryKey } from "@shared/hooks";
import { Button, Dialog } from "@shared/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

/** Allowlisted inline Hebrew for each typed disconnect-error reason (same mapping idiom as connect). */
const DISCONNECT_ERROR_HE: Record<ConnectErrorReason, string> = {
  auth: "ההתחברות פגה, התחברו מחדש",
  rate_limited: "יותר מדי ניסיונות, נסו שוב מאוחר יותר",
  not_configured: "Google לא מוגדר בשרת",
  unknown: "משהו השתבש, נסו שוב",
};

/**
 * #231 — a confirm dialog that DESTROYS the Google connection. The disconnect mutation is now SESSION-gated
 * (the Supabase cookie rides the request), so there's no setup CODE to re-type — just a confirm-before-destroy
 * step. On confirm it calls `disconnectGoogle()` then invalidates the `['google','status']` query so the card
 * re-reads the now-disconnected status. A typed api error maps to allowlisted inline Hebrew.
 */
export function DisconnectGoogleButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
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
      await disconnectGoogle();
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
            לנתק את חשבון ה‑Google? הסנכרון עם היומן והמייל ייפסק.
          </p>
          {error ? (
            <p
              role="alert"
              className="text-[13px] text-red-600"
              data-testid="disconnect-google-error"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="ink" disabled={submitting} className="w-full">
            נתק את החשבון
          </Button>
        </form>
      </Dialog>
    </>
  );
}
