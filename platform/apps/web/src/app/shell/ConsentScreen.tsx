import { useAcceptConsent } from "@shared/hooks";
import { Button, Card } from "@shared/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

/**
 * #270 — the one-time Terms/Privacy consent screen (no shell chrome), shown by {@link ConsentGate} to an
 * authenticated user who hasn't accepted the CURRENT terms. Blocks the board until accepted: a checkbox +
 * links to the Terms/Privacy pages, and an accept button disabled until the box is ticked. Accepting records
 * the opt-in (`POST /consent`) and the gate flips to the app. This is the WhatsApp opt-in + Amendment 13
 * consent capture; the linked pages carry the (placeholder) legal text + the version stamp.
 */
export function ConsentScreen() {
  const [checked, setChecked] = useState(false);
  const accept = useAcceptConsent();

  return (
    <div className="paper-grain flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md p-7 text-center shadow-float" data-testid="consent-screen">
        <div
          aria-hidden="true"
          className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-[26px]"
        >
          📝
        </div>
        <h1 className="mt-4 font-sans font-bold text-[22px] text-[color:var(--ink)]">
          לפני שמתחילים
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          כדי להשתמש ב-HomeOS ולחבר את הוואטסאפ, יש לאשר את התנאים.
        </p>

        <label className="mt-6 flex items-start gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-card/50 p-4 text-start">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-[18px] shrink-0 accent-primary"
            aria-label="אני מסכים/ה לתנאי השימוש ולמדיניות הפרטיות"
          />
          <span className="text-[14px] text-[color:var(--ink-2)] leading-relaxed">
            אני מסכים/ה ל
            <Link
              to="/terms"
              target="_blank"
              className="font-semibold text-primary hover:underline"
            >
              תנאי השימוש
            </Link>{" "}
            ול
            <Link
              to="/privacy"
              target="_blank"
              className="font-semibold text-primary hover:underline"
            >
              מדיניות הפרטיות
            </Link>
            , ולעיבוד המספר וההודעות שאעביר לצורך יצירת אירועים על הלוח.
          </span>
        </label>

        <Button
          variant="primary"
          className="mt-6 w-full"
          disabled={!checked || accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending ? "רגע…" : "אני מאשר/ת וממשיך/ה"}
        </Button>

        {accept.isError && (
          <p role="alert" className="mt-3 text-[13px] text-coral">
            לא הצלחנו לשמור את האישור. נסו שוב.
          </p>
        )}
      </Card>
    </div>
  );
}
