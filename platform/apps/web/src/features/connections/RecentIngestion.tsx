import { WhatsAppBubble } from "@features/ingestion";
import type { InboundMessageDTO, InboundOutcome } from "@homeos/shared";
import { useMessages } from "@shared/hooks";
import { Card, StatusPill, type StatusPillProps } from "@shared/ui";

/**
 * "Recent ingestion" — the raw inbound-message feed (#135) folded into the Connections screen (#182).
 * Still behind the DISTINCT messages token (via `useMessages`); the feed can hold pre-allowlist / non-
 * family text, so reading it stays a separate privilege from the events read. Each row reuses the literal
 * WhatsApp bubble; the old ad-hoc outcome pills now CONVERGE onto the shared StatusPill (design-system
 * §04) — labels unchanged, tones mapped onto the existing semantic set (success / attention / blocked /
 * neutral), so we don't re-introduce a one-off color into the primitive.
 */
const OUTCOME_META: Record<InboundOutcome, { label: string; tone: StatusPillProps["tone"] }> = {
  parsed: { label: "נוסף ליומן", tone: "active" }, // success → green
  clarified: { label: "נשאלה שאלה", tone: "pending" }, // needs the user's answer → blue
  refused: { label: "נחסם", tone: "overdue" }, // blocked → coral
  rephrase: { label: "לא הובן", tone: "archived" }, // no-op (was an identical slate)
  rate_limited: { label: "מעבר למכסה", tone: "archived" }, // no-op (was an identical slate)
  text_only: { label: "לא טקסט", tone: "archived" }, // no-op (was an identical slate)
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
    <StatusPill tone={meta.tone} data-testid="outcome-pill">
      {meta.label}
    </StatusPill>
  );
}

function MessageRow({ message }: { message: InboundMessageDTO }) {
  const body = message.text ?? MEDIA_LABELS[message.type] ?? `[${message.type}]`;
  // received_at is ISO-8601 UTC ("…Z"); new Date parses the instant, formatted in Jerusalem.
  const when = dateTimeFmt.format(new Date(message.received_at));
  return (
    <li className="flex flex-col gap-1.5" data-testid="message-row">
      <WhatsAppBubble variant="user">{body}</WhatsAppBubble>
      <div className="flex items-center gap-2 self-end text-[11px] text-muted-foreground">
        <OutcomePill outcome={message.outcome} />
        <time dateTime={message.received_at}>{when}</time>
      </div>
    </li>
  );
}

export function RecentIngestion() {
  const { data, isLoading, isError } = useMessages();

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]" data-testid="recent-ingestion">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[14.5px] text-[color:var(--ink)]">קליטה אחרונה</span>
        <span className="font-accent text-[13px] text-muted-foreground">מה שהבוט קיבל לאחרונה</span>
      </div>

      {isLoading && <p className="text-[13px] text-muted-foreground">טוען…</p>}
      {isError && (
        <p className="text-[13px] text-coral" role="alert">
          לא הצלחנו לטעון את ההודעות 🙁
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-[13px] text-muted-foreground">עדיין אין הודעות 📭</p>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.map((m) => (
            <MessageRow key={m.wa_message_id} message={m} />
          ))}
        </ul>
      )}
    </Card>
  );
}
