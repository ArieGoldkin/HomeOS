import type { ParsedEvent, SavedEventSource } from "@homeos/shared";
import type { EventRow } from "../schema.ts";
import type { SavedEvent } from "./types.ts";

/**
 * #151 — derive the served `source` from the row's idempotency-key prefix (the most precise signal: it
 * distinguishes a web-added row from a forwarded one, which `source_provider` alone cannot).
 *
 * F2: this couples provenance to the `wa_message_id` prefixes the PRODUCERS mint — keep these branches in
 * lockstep with: `gmail:` (tools readGmailTool), `gcal:` (tools readCalendarTool), `web:` (http
 * POST /events), else a Meta `wamid.*` → whatsapp. `startsWith` (not substring) is load-bearing; an
 * unknown prefix falls back to `whatsapp`. The prefix→source map is pinned by tests in event-store.test.ts
 * so a producer changing a prefix breaks a test, not a UI badge.
 */
export function deriveSource(waMessageId: string): SavedEventSource {
  if (waMessageId.startsWith("gmail:")) return "gmail";
  if (waMessageId.startsWith("gcal:")) return "gcal";
  if (waMessageId.startsWith("web:")) return "web";
  return "whatsapp";
}

export function rowToSaved(row: EventRow): SavedEvent {
  return {
    id: row.id,
    kind: row.kind as ParsedEvent["kind"],
    title_he: row.title_he,
    date_iso: row.date_iso,
    time: row.time,
    location: row.location,
    assignee: row.assignee,
    recurrence:
      row.recurrence_freq === "weekly" && row.recurrence_weekday !== null
        ? { freq: "weekly", weekday: row.recurrence_weekday }
        : null,
    source_text: row.source_text,
    source_provider: row.source_provider,
    // #151 — provenance for the UI badge/detail view. `source` is derived (no stored column). F1:
    // SQLite stores created_at as UTC "YYYY-MM-DD HH:MM:SS" (no T/offset); emit it as ISO-8601 UTC so a
    // consumer's `new Date(...)` reads the right instant instead of mis-parsing the bare string as LOCAL.
    source: deriveSource(row.wa_message_id),
    created_at: `${row.created_at.replace(" ", "T")}Z`,
    // #19 — the column is NOT NULL DEFAULT 'open', so a legacy row (migrated in) and every new row read
    // back here as 'open'; narrow defensively to the enum (any non-'done' value → "open").
    status: row.status === "done" ? "done" : "open",
  };
}
