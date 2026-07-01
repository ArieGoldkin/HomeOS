import type { DatabaseSync } from "node:sqlite";

/**
 * #85: the date/time base shared by `findEventsByRef`/`searchEvents`/`findEventsInScope`. Each title/scope
 * clause is appended PER-CALL (variable word count) in the factory; date/time are "null OR matches" so the
 * base handles any subset. Exported because the three matchers in index.ts `db.prepare(sql)` per call.
 */
export const findByRefBase =
  "SELECT * FROM events WHERE source_provider IS NULL AND (? IS NULL OR date_iso = ?) AND (? IS NULL OR time = ?)";

/**
 * The static prepared statements, created once over the factory's single `db` handle. Kept in their own
 * module so `index.ts` stays the thin factory + the read/write method bodies; the dynamic per-call matchers
 * (whose SQL varies with the title word count) are NOT here — they `db.prepare(sql)` in the methods.
 */
export function prepareStatements(db: DatabaseSync) {
  // Idempotent per (wa_message_id, seq): a re-processed inbound (boot-replay, Meta retry) returns
  // the existing row per event instead of inserting duplicates. The no-op DO UPDATE lets RETURNING
  // fire on conflict.
  const insert = db.prepare(
    `INSERT INTO events
       (kind, title_he, date_iso, time, location, assignee, recurrence_freq, recurrence_weekday,
        source_text, from_phone, wa_message_id, seq, source_provider, standing_cadence, standing_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  // #86: read the target board row (never a synced row), then write the re-validated merge back. Both
  // statements are scoped `source_provider IS NULL` so a gcal/gmail row is never read OR written here.
  const selectBoardByIdStmt = db.prepare(
    "SELECT * FROM events WHERE id = ? AND source_provider IS NULL;",
  );
  const updateByIdStmt = db.prepare(
    `UPDATE events
       SET kind = ?, title_he = ?, date_iso = ?, time = ?, location = ?, assignee = ?,
           recurrence_freq = ?, recurrence_weekday = ?
     WHERE id = ? AND source_provider IS NULL
     RETURNING *;`,
  );
  // #19: board-scoped (source_provider IS NULL) status toggle. A no-match (synced row / bad id) RETURNs
  // nothing → the method returns null, so a synced gcal/gmail row can never be toggled.
  const setStatusStmt = db.prepare(
    "UPDATE events SET status = ? WHERE id = ? AND source_provider IS NULL RETURNING *;",
  );
  // Slot dedup: a board row (source_provider IS NULL) already occupying this (date_iso, time) from a
  // DIFFERENT message (wa_message_id !=), so a re-send is caught but a boot-replay of the SAME message
  // (which upserts its own rows) is not. Newest-first; one row is enough to flag the slot as taken.
  const findSlotStmt = db.prepare(
    `SELECT * FROM events
     WHERE source_provider IS NULL AND date_iso = ? AND time = ? AND wa_message_id != ?
     ORDER BY id DESC
     LIMIT 1;`,
  );
  // #28/#224: OPEN reminders due on a date (board rows only) for the daily-digest morning nudge. Earliest-
  // time first; untimed reminders (`time IS NULL` → sorts last) trail. `done` rows excluded so a reminder
  // fires once on its day and never re-surfaces after being acted on. `kind`/`status` are trusted enum
  // literals. #224 — a row matches EITHER as a one-shot on its `date_iso`, OR as a STANDING daily reminder
  // whose bounded window covers the queried date (anchor `date_iso <= d <= standing_until`) — so one row
  // surfaces every in-window day without materializing per-day rows. The date `?` is bound THREE times.
  const remindersDueStmt = db.prepare(
    `SELECT * FROM events
     WHERE source_provider IS NULL AND kind = 'reminder'
       AND (status IS NULL OR status != 'done')
       AND ( date_iso = ?
             OR (standing_cadence = 'daily' AND date_iso <= ? AND standing_until >= ?) )
     ORDER BY time IS NULL, time ASC, id ASC;`,
  );

  return {
    insert,
    selectAll,
    deleteLast,
    countSinceStmt,
    deleteByProviderStmt,
    deleteByIdStmt,
    selectBoardByIdStmt,
    updateByIdStmt,
    setStatusStmt,
    findSlotStmt,
    remindersDueStmt,
  };
}
