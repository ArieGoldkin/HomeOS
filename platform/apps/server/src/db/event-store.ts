import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { ParsedEvent } from "@homeos/shared";
import { ADD_EVENTS_SOURCE_PROVIDER, CREATE_EVENTS_TABLE, type EventRow } from "./schema.ts";

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
  /** Provider that produced the row ('google' for Gmail/Calendar-derived); null for forwards (#61/MF5). */
  sourceProvider?: string;
}

export interface SavedEvent extends ParsedEvent {
  id: number;
  /** null for forwarded events; the provider name for derived rows (#61). */
  source_provider: string | null;
}

/** Persistence seam — handlers depend on this, not on the driver. */
export interface EventStore {
  saveEvent(event: ParsedEvent, meta: EventMeta): SavedEvent;
  listEvents(): SavedEvent[];
  /** Delete all events from the sender's most recent message (the `ביטול` undo). Returns the count. */
  deleteLastFromSender(fromPhone: string): number;
  /** Count events created at/after `sinceIso` (SQLite UTC datetime). Feeds the daily digest. */
  countSince(sinceIso: string): number;
  /** Purge every row tagged with `provider` — the disconnect deletion seam (#61/MF5). Returns the count. */
  deleteByProvider(provider: string): number;
  /**
   * #85 — delete ONE board row by id. FAMILY-scoped (`source_provider IS NULL` only: a board row, never a
   * gcal/gmail-derived row); `familyId` is the reserved Phase-8 contract. Returns the count (0 or 1).
   */
  deleteById(id: number, familyId: string): number;
  /**
   * #85 — FAMILY-scoped reference lookup for `בטל <ref>` (board rows only, `source_provider IS NULL`).
   * ANDs the provided fields (date_iso = / time = / title_he LIKE %hint%), newest-first (ORDER BY id DESC),
   * capped at 5 with NO speculative ranking — N>1 goes to a disambiguation thread. `familyId` is reserved.
   */
  findEventsByRef(
    familyId: string,
    ref: { dateIso?: string; time?: string; titleHint?: string },
  ): SavedEvent[];
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
    source_provider: row.source_provider,
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
  // #61: ensure source_provider exists on a pre-existing events table (CREATE IF NOT EXISTS won't add it).
  const cols = db.prepare("PRAGMA table_info(events);").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "source_provider")) db.exec(ADD_EVENTS_SOURCE_PROVIDER);

  // Idempotent per (wa_message_id, seq): a re-processed inbound (boot-replay, Meta retry) returns
  // the existing row per event instead of inserting duplicates. The no-op DO UPDATE lets RETURNING
  // fire on conflict.
  const insert = db.prepare(
    `INSERT INTO events
       (kind, title_he, date_iso, time, location, assignee, recurrence_freq, recurrence_weekday,
        source_text, from_phone, wa_message_id, seq, source_provider)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const countSinceStmt = db.prepare("SELECT COUNT(*) AS c FROM events WHERE created_at >= ?;");
  const deleteByProviderStmt = db.prepare("DELETE FROM events WHERE source_provider = ?;");
  // #85: family-scoped = board rows only (source_provider IS NULL). Delete by id never touches a
  // provider-derived row even if the id matches.
  const deleteByIdStmt = db.prepare("DELETE FROM events WHERE id = ? AND source_provider IS NULL;");
  // #85: each ref field is "null OR matches" so one prepared statement handles any subset; the title is
  // a substring (LIKE %hint%). Newest-first, cap 5, no ranking — the handler disambiguates N>1.
  const findByRefStmt = db.prepare(
    `SELECT * FROM events
     WHERE source_provider IS NULL
       AND (? IS NULL OR date_iso = ?)
       AND (? IS NULL OR time = ?)
       AND (? IS NULL OR title_he LIKE ?)
     ORDER BY id DESC
     LIMIT 5;`,
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
        meta.sourceProvider ?? null,
      ) as unknown as EventRow;
      return rowToSaved(row);
    },
    listEvents() {
      return (selectAll.all() as unknown as EventRow[]).map(rowToSaved);
    },
    deleteLastFromSender(fromPhone) {
      return Number(deleteLast.run(fromPhone, fromPhone).changes);
    },
    countSince(sinceIso) {
      return Number((countSinceStmt.get(sinceIso) as { c: number }).c);
    },
    deleteByProvider(provider) {
      return Number(deleteByProviderStmt.run(provider).changes);
    },
    deleteById(id, _familyId) {
      // _familyId is the reserved contract — family-scope today is "board rows only" (above).
      return Number(deleteByIdStmt.run(id).changes);
    },
    findEventsByRef(_familyId, ref) {
      const titleLike = ref.titleHint ? `%${ref.titleHint}%` : null;
      const rows = findByRefStmt.all(
        ref.dateIso ?? null,
        ref.dateIso ?? null,
        ref.time ?? null,
        ref.time ?? null,
        titleLike,
        titleLike,
      ) as unknown as EventRow[];
      return rows.map(rowToSaved);
    },
  };
}
