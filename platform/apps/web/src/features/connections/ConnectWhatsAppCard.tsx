import { useBindingCode, useChannel } from "@shared/hooks";
import { Button, Card, SectionLabel } from "@shared/ui";

/** The prefilled WhatsApp message body carrying the binding code — the same sentinel the bot's tolerant
 *  regex matches inside surrounding prose. Kept in one place so the wa.me link and the copy text agree. */
function bindingMessage(code: string): string {
  return `קוד חיבור HomeOS: ${code}`;
}

/** Digits-only form of the display number for the wa.me path (`+972 50-123 4567` → `972501234567`); wa.me
 *  wants the international number with no `+`/spaces/dashes. Null when the server has no BOT_PHONE_NUMBER. */
function waDigits(botPhone: string | null | undefined): string | null {
  if (!botPhone) return null;
  const digits = botPhone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * #228 (web half) — the wa.me phone-binding card on the Connections screen. A logged-in member requests a
 * single-use `HOME-XXXXX` code (`POST /binding` → `useBindingCode`), then echoes it to the bot over WhatsApp;
 * the inbound handler's binding branch (`matchBinding`) proves phone ownership and writes the `family_phones`
 * row — after which the number appears in the owner's {@link LinkedPhones} list and the bot accepts its
 * forwards. Session-gated (the whole page is behind auth); minting is writer-only server-side (a viewer's
 * click 403s → the error notice). The code is fetched on explicit intent (the button), not on mount, since
 * each mint burns a fresh 10-min-TTL code.
 *
 * When `BOT_PHONE_NUMBER` is set the card offers a one-tap `wa.me` deep link with the code prefilled; when it
 * is null (unconfigured server) it degrades to the copyable code + the exact message to send manually.
 */
export function ConnectWhatsAppCard() {
  const { data: channel } = useChannel();
  const mint = useBindingCode();
  const code = mint.data;
  const digits = waDigits(channel?.botPhone);
  const waHref =
    code && digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(bindingMessage(code))}`
      : null;

  const copyCode = () => {
    if (code) void navigator.clipboard?.writeText(code);
  };

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]" data-testid="connect-whatsapp">
      <SectionLabel>חיבור מספר וואטסאפ</SectionLabel>
      <p className="text-[13px] text-muted-foreground">
        חברו את מספר הוואטסאפ שלכם כדי שהבוט יקבל את ההודעות שאתם מעבירים.
      </p>

      {code ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-[color:var(--ink-2)]">
            שלחו לבוט את ההודעה הבאה מהוואטסאפ שלכם:
          </p>
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--chip-border)] bg-[var(--chip-bg)] px-3.5 py-2.5">
            <code
              dir="ltr"
              data-testid="binding-code"
              className="select-all font-mono font-semibold text-[15px] text-[color:var(--ink)] tracking-wide"
            >
              {code}
            </code>
            <Button
              variant="ghost"
              className="min-h-9 px-3 text-[13px]"
              aria-label="העתקת הקוד"
              onClick={copyCode}
            >
              העתקה
            </Button>
          </div>
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center rounded-[var(--radius)] bg-wa-green px-4 font-semibold text-[14px] text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              פתיחת וואטסאפ ושליחת הקוד
            </a>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              שלחו את ההודעה למספר הבוט של HomeOS מהוואטסאפ שלכם.
            </p>
          )}
          <Button
            variant="ghost"
            className="self-start px-0 text-[12px] text-muted-foreground"
            onClick={() => mint.mutate()}
            disabled={mint.isPending}
          >
            קוד חדש
          </Button>
        </div>
      ) : (
        <Button
          variant="ink"
          className="min-h-10 self-start px-4 text-[13px]"
          onClick={() => mint.mutate()}
          disabled={mint.isPending}
        >
          {mint.isPending ? "רגע…" : "קבלת קוד חיבור"}
        </Button>
      )}

      {mint.isError && (
        <p role="alert" className="text-[13px] text-coral">
          לא הצלחנו ליצור קוד חיבור. נסו שוב.
        </p>
      )}
    </Card>
  );
}
