import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { ParsedEvent } from "@homeos/shared";
import { CREATE_EVENTS_TABLE, type EventRow } from "./schema.ts";

// node:sqlite is a newer builtin that bundlers (Vite/Vitest) don't externalize cleanly;
// loading it via createRequire keeps it a runtime resolution Node handles directly.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

export interface EventMeta {
  fromPhone: string;
  waMessageId: string;
  /** Index of this event within its message (0-based); distinguishes multi-event rows. */
  seq?: number;
}

export interface SavedEvent extends ParsedEvent {
  id: number;
}

/** Persistence seam — handlers depend on this, not on the driver. */
export interface EventStore {
  saveEvent(event: ParsedEvent, meta: EventMeta): SavedEvent;
  listEvents(): SavedEvent[];
  /** Delete all events from the sender's most recent message (the `ביטול` undo). Returns the count. */
  deleteLastFromSender(fromPhone: string): number;
}

function rowToSaved(row: EventRow): SavedEvent {
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
  };
}

/**
 * SQLite-backed EventStore using Node's built-in driver (node:sqlite). "One family = one file."
 * Pass ":memory:" in tests; a real path has its parent directory created.
 */
export function createEventStore(dbPath: string): EventStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_EVENTS_TABLE);

  // Idempotent per (wa_message_id, seq): a re-processed inbound (boot-replay, Meta retry) returns
  // the existing row per event instead of inserting duplicates. The no-op DO UPDATE lets RETURNING
  // fire on conflict.
  const insert = db.prepare(
    `INSERT INTO events
       (kind, title_he, date_iso, time, location, assignee, recurrence_freq, recurrence_weekday,
        source_text, from_phone, wa_message_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(wa_message_id, seq) DO UPDATE SET wa_message_id = excluded.wa_message_id
     RETURNING *;`,
  );
  const selectAll = db.prepare("SELECT * FROM events ORDER BY id;");
  // Undo: delete every row of the sender's most recent message (all seqs of that wa_message_id).
  const deleteLast = db.prepare(
    `DELETE FROM events
     WHERE from_phone = ?
       AND wa_message_id = (
         SELECT wa_message_id FROM events WHERE from_phone = ? ORDER BY id DESC LIMIT 1
       );`,
  );

  return {
    saveEvent(event, meta) {
      const row = insert.get(
        event.kind,
        event.title_he,
        event.date_iso,
        event.time,
        event.location,
        event.assignee,
        event.recurrence?.freq ?? null,
        event.recurrence?.weekday ?? null,
        event.source_text,
        meta.fromPhone,
        meta.waMessageId,
        meta.seq ?? 0,
      ) as unknown as EventRow;
      return rowToSaved(row);
    },
    listEvents() {
      return (selectAll.all() as unknown as EventRow[]).map(rowToSaved);
    },
    deleteLastFromSender(fromPhone) {
      return Number(deleteLast.run(fromPhone, fromPhone).changes);
    },
  };
}
