/**
 * Single-family events table. DDL kept as plain SQL for node:sqlite; a query builder
 * (Drizzle) can be layered later behind the EventStore interface without touching callers.
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
    wa_message_id TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
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
