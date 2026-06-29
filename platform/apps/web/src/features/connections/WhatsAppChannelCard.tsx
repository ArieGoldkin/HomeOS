import { useChannel } from "@shared/hooks";
import { Card, Skeleton, StatusPill } from "@shared/ui";

/**
 * The WhatsApp channel hero (#182) — the primary connection: the bot's number + a live status pill. The
 * channel identity uses the WhatsApp brand green (`--wa-green`, the integration color), while the status
 * reads from the shared StatusPill vocab (design-system §04). The number is LTR within the RTL page.
 *
 * #231 (Slice B) — the number comes from `GET /channel` (`useChannel`), no longer a hardcoded BOT_NUMBER.
 * While loading it shows a skeleton; when the server has no number configured (`botPhone: null`) or the read
 * fails it shows a neutral "—" rather than a fake number. The channel itself is always live, so the status
 * pill stays "מחובר".
 */
export function WhatsAppChannelCard() {
  const { data, status } = useChannel();

  return (
    <Card className="flex items-center gap-4 p-[18px]" data-testid="wa-channel">
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-wa-green/12 text-[22px]"
      >
        📲
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[15px] text-[color:var(--ink)]">ערוץ הוואטסאפ</p>
        {status === "pending" ? (
          <Skeleton variant="line" className="mt-1.5 w-32" />
        ) : (
          <p
            dir="ltr"
            data-testid="wa-bot-number"
            className="text-start font-mono text-[13px] text-ink-soft tracking-wide"
          >
            {data?.botPhone ?? "—"}
          </p>
        )}
      </div>
      <StatusPill tone="active">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        מחובר
      </StatusPill>
    </Card>
  );
}
