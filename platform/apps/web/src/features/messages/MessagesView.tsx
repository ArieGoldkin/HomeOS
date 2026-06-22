import { WhatsAppBubble } from "@features/ingestion";
import type { InboundMessageDTO, InboundOutcome } from "@homeos/shared";
import { useMessages } from "@shared/hooks";

/**
 * #135 [D2] — the raw inbound-message feed: the "what did the bot receive and what happened" inbox,
 * complementary to the structured events board. Web-only and behind a DISTINCT token — the no-auth
 * kitchen kiosk never reaches it (the raw text can hold other people's words / pre-allowlist content).
 * Presentational shell + the `useMessages` poll; each row reuses the WhatsApp bubble + an outcome pill.
 */

/** Hebrew label + pill color per terminal disposition. Raw Tailwind palette (like WhatsAppBubble's
 *  literal WA colors) so a status pill reads the same regardless of the app's light/dark theme. */
const OUTCOME_META: Record<InboundOutcome, { label: string; className: string }> = {
  parsed: { label: "נוסף ליומן", className: "bg-emerald-100 text-emerald-800" },
  clarified: { label: "נשאלה שאלה", className: "bg-amber-100 text-amber-800" },
  rephrase: { label: "לא הובן", className: "bg-slate-100 text-slate-700" },
  refused: { label: "נחסם", className: "bg-rose-100 text-rose-800" },
  rate_limited: { label: "מעבר למכסה", className: "bg-slate-100 text-slate-700" },
  text_only: { label: "לא טקסט", className: "bg-slate-100 text-slate-700" },
};

/** Media-type placeholder for a non-text message (which has null text + no event). */
const MEDIA_LABELS: Record<string, string> = {
  audio: "🎤 הודעה קולית",
  image: "🖼️ תמונה",
  video: "🎬 וידאו",
  document: "📄 מסמך",
  sticker: "🏷️ מדבקה",
};

// he-IL, Asia/Jerusalem — short date + time. NOTE he-IL renders the hour UNPADDED ("9:00", not "09:00").
const dateTimeFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function OutcomePill({ outcome }: { outcome: InboundOutcome | null }) {
  if (outcome === null) return null;
  const meta = OUTCOME_META[outcome];
  return (
    <span
      data-testid="outcome-pill"
      className={`rounded-full px-2 py-0.5 font-medium text-[11px] ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function MessageRow({ message }: { message: InboundMessageDTO }) {
  const body = message.text ?? MEDIA_LABELS[message.type] ?? `[${message.type}]`;
  // received_at is ISO-8601 UTC ("…Z"); new Date parses the instant, formatted in Jerusalem.
  const when = dateTimeFmt.format(new Date(message.received_at));
  return (
    <li className="flex flex-col gap-1" data-testid="message-row">
      <WhatsAppBubble variant="user">{body}</WhatsAppBubble>
      <div className="flex items-center gap-2 self-end text-[11px] text-muted-foreground">
        <OutcomePill outcome={message.outcome} />
        <time dateTime={message.received_at}>{when}</time>
      </div>
    </li>
  );
}

export function MessagesView() {
  const { data, isLoading, isError } = useMessages();

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6" data-testid="messages-view">
      <header>
        <h1 className="font-display font-bold text-[22px] text-foreground">הודעות</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          כל ההודעות שהתקבלו ומה קרה לכל אחת.
        </p>
      </header>

      {isLoading && <p className="text-[14px] text-muted-foreground">טוען…</p>}
      {isError && (
        <p className="text-[14px] text-rose-700" role="alert">
          לא הצלחנו לטעון את ההודעות 🙁
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-[14px] text-muted-foreground">עדיין אין הודעות 📭</p>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.map((m) => (
            <MessageRow key={m.wa_message_id} message={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
