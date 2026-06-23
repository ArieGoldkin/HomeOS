import { Card, StatusPill } from "@shared/ui";

// The bot's WhatsApp number — a placeholder until a real channel-config source exists (mirrors the
// CURRENT_USER / roster placeholders elsewhere). Rendered LTR inside the RTL layout (it's a phone number).
const BOT_NUMBER = "+972 50-000-0000";

/**
 * The WhatsApp channel hero (#182) — the primary connection: the bot's number + a live status pill.
 * The channel identity uses the WhatsApp brand green (`--wa-green`, the integration color), while the
 * status reads from the shared StatusPill vocab (design-system §04). The number is LTR within the RTL page.
 */
export function WhatsAppChannelCard() {
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
        <p dir="ltr" className="text-start font-mono text-[13px] text-ink-soft tracking-wide">
          {BOT_NUMBER}
        </p>
      </div>
      <StatusPill tone="active">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        מחובר
      </StatusPill>
    </Card>
  );
}
