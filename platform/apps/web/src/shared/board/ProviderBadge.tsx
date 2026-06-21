import type { SavedEventSource } from "@homeos/shared";

/**
 * #151 — a quiet provenance marker shown ONLY on provider-synced rows (Gmail / Google Calendar), so a
 * glance distinguishes a synced item from a forwarded/added one. Forwarded WhatsApp and web-added rows
 * are the local default and render NOTHING (returns null). It shows provenance, not `source_text`, so it
 * is safe on every surface incl. the kitchen-tablet kiosk (the detail drawer, which shows the original
 * text, is the phone/web-only surface — see EventDetail).
 */
const PROVIDER_LABEL: Partial<Record<SavedEventSource, string>> = {
  gmail: "מ-Gmail",
  gcal: "מהיומן",
};

export interface ProviderBadgeProps {
  source?: SavedEventSource;
}

export function ProviderBadge({ source }: ProviderBadgeProps) {
  const label = source ? PROVIDER_LABEL[source] : undefined;
  if (!label) return null;
  return (
    <span
      data-testid="provider-badge"
      className="inline-flex items-center rounded-sm bg-muted px-1.5 py-px text-[11px] text-muted-foreground"
    >
      {label}
    </span>
  );
}
