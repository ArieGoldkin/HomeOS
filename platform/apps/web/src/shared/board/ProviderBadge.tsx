import type { SavedEventSource } from "@homeos/shared";
import type { ReactNode } from "react";

/**
 * #151 — a quiet provenance marker shown ONLY on provider-synced rows (Gmail / Google Calendar), so a
 * glance distinguishes a synced item from a forwarded/added one. Forwarded WhatsApp and web-added rows
 * are the local default and render NOTHING (returns null). It shows provenance, not `source_text`, so it
 * is safe on every surface incl. the kitchen-tablet kiosk (the detail drawer, which shows the original
 * text, is the phone/web-only surface — see #153).
 *
 * F3 — the Latin "Gmail" run is wrapped in <bdi> so the Hebrew↔Latin boundary (the neutral hyphen) can't
 * flip under bidi reordering in the RTL label (DESIGN.md §11, matching EventCard's dir="ltr" time atom).
 * "מהיומן" is pure Hebrew, so it needs no isolate.
 */
const PROVIDER_CONTENT: Partial<Record<SavedEventSource, ReactNode>> = {
  gmail: (
    <>
      מ-<bdi>Gmail</bdi>
    </>
  ),
  gcal: "מהיומן",
};

export interface ProviderBadgeProps {
  source?: SavedEventSource;
}

export function ProviderBadge({ source }: ProviderBadgeProps) {
  const content = source ? PROVIDER_CONTENT[source] : undefined;
  if (!content) return null;
  return (
    <span
      data-testid="provider-badge"
      className="inline-flex items-center rounded-sm bg-muted px-1.5 py-px text-[13px] text-muted-foreground"
    >
      {content}
    </span>
  );
}
