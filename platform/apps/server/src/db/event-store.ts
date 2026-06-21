import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { type ParsedEvent, parsedEventSchema } from "@homeos/shared";
import { ADD_EVENTS_SOURCE_PROVIDER, CREATE_EVENTS_TABLE, type EventRow } from "./schema.ts";

/** #86 — the fields a `שנה <ref>` / correction may change in place. A subset of ParsedEvent; merged
 *  onto the target row and re-validated (G20) before the write. */
export type EventPatch = Partial<
  Pick<ParsedEvent, "date_iso" | "time" | "location" | "title_he" | "assignee" | "recurrence">
>;

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
  /**
   * #86 — edit a board row in place. FAMILY-scoped (`source_provider IS NULL` only: a synced gcal/gmail
   * row is NEVER written, preventing a read→write loop). Merges `patch` onto the row, re-validates the
   * MERGED row via `parsedEventSchema` BEFORE the write (G20), and returns the updated `SavedEvent` — or
   * null if the target isn't a board row or the merge is invalid (no write happens).
   */
  updateEvent(id: number, patch: EventPatch, familyId: string): SavedEvent | null;
  /**
   * Slot dedup — an existing BOARD row (`source_provider IS NULL`) at the same `(date_iso, time)`,
   * excluding the caller's own `excludeWaMessageId` so a boot-replay of a message never collides with
   * the rows it already saved (those upsert on `(wa_message_id, seq)`). Returns the existing row or
   * null. `familyId` is the reserved Phase-8 contract; the caller passes a NON-NULL time (a null-time
   * item has no "slot" and is never deduped).
   */
  findSlotConflict(
    familyId: string,
    slot: { dateIso: string; time: string; excludeWaMessageId: string },
  ): SavedEvent | null;
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

/** Stopwords a cancel/edit title hint carries but a stored title rarely does — dropped so they don't
 *  over-broaden (or, when alone, accidentally null out) the match. */
const HINT_STOPWORDS = new Set(["עם", "את", "של", "או", "גם", "יום"]);
/** Escape LIKE metacharacters so a hint like "50%" matches literally, not as a wildcard (#125/F3). */
const likeArg = (s: string): string => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * #85 — turn a free-text title hint into per-WORD LIKE variants, AND-ed by the caller. Each word also
 * yields a ה/ו-stripped variant (OR-ed with the original) so a hint carrying the Hebrew definite article
 * — "הפגישה" — matches a bare stored title "פגישה" (a live cancel miss), WITHOUT dropping a word that
 * legitimately starts with ה (e.g. "הורים" still matches via its original form). Stopwords + sub-2-char
 * tokens are removed. Returns `[]` when nothing usable remains so the caller can fall back to the raw hint
 * (never broadening a hint-bearing lookup into "match everything").
 */
function hintLikeGroups(hint: string): string[][] {
  const groups: string[][] = [];
  for (const word of hint.split(/\s+/u)) {
    if (word.length < 2 || HINT_STOPWORDS.has(word)) continue;
    const variants = new Set([word]);
    const stripped = word.replace(/^[הו]/u, "");
    if (stripped.length >= 2) variants.add(stripped);
    groups.push([...variants].map(likeArg));
  }
  return groups;
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
  // #85: date/time are "null OR matches" so the base statement handles any subset. The title clause is
  // built PER-CALL (variable word count, see findEventsByRef) — each word is an AND'd group of OR'd
  // LIKE variants, all escaped with ESCAPE '\' so a literal '%' can't broaden a DESTRUCTIVE match
  // (#125/F3). Newest-first, cap 5, no ranking — the handler disambiguates N>1.
  const findByRefBase =
    "SELECT * FROM events WHERE source_provider IS NULL AND (? IS NULL OR date_iso = ?) AND (? IS NULL OR time = ?)";
  // Slot dedup: a board row (source_provider IS NULL) already occupying this (date_iso, time) from a
  // DIFFERENT message (wa_message_id !=), so a re-send is caught but a boot-replay of the SAME message
  // (which upserts its own rows) is not. Newest-first; one row is enough to flag the slot as taken.
  const findSlotStmt = db.prepare(
    `SELECT * FROM events
     WHERE source_provider IS NULL AND date_iso = ? AND time = ? AND wa_message_id != ?
     ORDER BY id DESC
     LIMIT 1;`,
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
      const params: (string | null)[] = [
        ref.dateIso ?? null,
        ref.dateIso ?? null,
        ref.time ?? null,
        ref.time ?? null,
      ];
      // Per-word groups (each = OR'd variants); AND them. A hint that tokenizes to nothing falls back to
      // one literal LIKE on the raw hint so a hint-bearing lookup never silently widens to every row.
      let groups = ref.titleHint ? hintLikeGroups(ref.titleHint) : [];
      if (ref.titleHint && groups.length === 0) groups = [[likeArg(ref.titleHint.trim())]];
      const titleSql = groups
        .map((variants) => `(${variants.map(() => "title_he LIKE ? ESCAPE '\\'").join(" OR ")})`)
        .join(" AND ");
      for (const variants of groups) params.push(...variants);
      const sql = `${findByRefBase}${titleSql ? ` AND ${titleSql}` : ""} ORDER BY id DESC LIMIT 5;`;
      const rows = db.prepare(sql).all(...params) as unknown as EventRow[];
      return rows.map(rowToSaved);
    },
    findSlotConflict(_familyId, slot) {
      const row = findSlotStmt.get(slot.dateIso, slot.time, slot.excludeWaMessageId) as unknown as
        | EventRow
        | undefined;
      return row ? rowToSaved(row) : null;
    },
    updateEvent(id, patch, _familyId) {
      const row = selectBoardByIdStmt.get(id) as unknown as EventRow | undefined;
      if (!row) return null; // not a board row (synced / nonexistent) → no write
      // Merge the patch onto the current row, then re-validate the WHOLE candidate (G20). zod strips
      // the `id`/`source_provider` extras; an invalid field (e.g. a bad date) fails → null, no write.
      const parsed = parsedEventSchema.safeParse({ ...rowToSaved(row), ...patch });
      if (!parsed.success) return null;
      const e = parsed.data;
      const updated = updateByIdStmt.get(
        e.kind,
        e.title_he,
        e.date_iso,
        e.time,
        e.location,
        e.assignee,
        e.recurrence?.freq ?? null,
        e.recurrence?.weekday ?? null,
        id,
      ) as unknown as EventRow;
      return rowToSaved(updated);
    },
  };
}
