/**
 * Single-family events table. DDL kept as plain SQL for node:sqlite; a query builder
 * (Drizzle) can be layered later behind the EventStore interface without touching callers.
 * `wa_message_id` is UNIQUE so re-processing the same inbound (e.g. boot-replay) is a no-op
 * upsert rather than a duplicate row.
 */
export const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT    NOT NULL,
    title_he      TEXT    NOT NULL,
    date_iso      TEXT    NOT NULL,
    time          TEXT,
    location      TEXT,
    source_text   TEXT    NOT NULL,
    from_phone    TEXT    NOT NULL,
    wa_message_id TEXT    NOT NULL UNIQUE,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * Inbound queue: every webhook message is persisted here BEFORE the 200 ack, so a crash
 * between ack and completion never silently drops it (boot-replays `status = 'pending'`).
 * The `wa_message_id` PRIMARY KEY is also the durable dedupe (Meta delivers at-least-once),
 * replacing the in-memory idempotency store. `status`: pending → done | failed.
 */
export const CREATE_INBOUND_TABLE = `
  CREATE TABLE IF NOT EXISTS inbound_messages (
    wa_message_id TEXT PRIMARY KEY,
    from_phone    TEXT NOT NULL,
    type          TEXT NOT NULL,
    text          TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    received_at   TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at  TEXT
  );
`;

export interface EventRow {
  id: number;
  kind: string;
  title_he: string;
  date_iso: string;
  time: string | null;
  location: string | null;
  source_text: string;
  from_phone: string;
  wa_message_id: string;
  created_at: string;
}

export interface InboundRow {
  wa_message_id: string;
  from_phone: string;
  type: string;
  text: string | null;
  status: string;
  received_at: string;
  processed_at: string | null;
}
