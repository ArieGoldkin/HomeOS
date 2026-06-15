/**
 * Single-family events table. DDL kept as plain SQL for node:sqlite; a query builder
 * (Drizzle) can be layered later behind the EventStore interface without touching callers.
 * One message can yield several events, so each row carries a `seq` (its index within the
 * message) and uniqueness is on `(wa_message_id, seq)` — re-processing the same inbound (e.g.
 * boot-replay) is a no-op upsert per event rather than a duplicate row. Weekly `recurrence`
 * is stored as freq + weekday columns; `assignee` is the family member it's for.
 */
export const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    kind               TEXT    NOT NULL,
    title_he           TEXT    NOT NULL,
    date_iso           TEXT    NOT NULL,
    time               TEXT,
    location           TEXT,
    assignee           TEXT,
    recurrence_freq    TEXT,
    recurrence_weekday INTEGER,
    source_text        TEXT    NOT NULL,
    from_phone         TEXT    NOT NULL,
    wa_message_id      TEXT    NOT NULL,
    seq                INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(wa_message_id, seq)
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
  assignee: string | null;
  recurrence_freq: string | null;
  recurrence_weekday: number | null;
  source_text: string;
  from_phone: string;
  wa_message_id: string;
  seq: number;
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
