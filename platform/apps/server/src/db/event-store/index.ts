import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { parsedEventSchema, STANDING_MAX_DAYS, STANDING_WINDOW_DAYS } from "@homeos/shared";
import {
  ADD_EVENTS_SOURCE_PROVIDER,
  ADD_EVENTS_STANDING_CADENCE,
  ADD_EVENTS_STANDING_UNTIL,
  ADD_EVENTS_STATUS,
  CREATE_EVENTS_TABLE,
  type EventRow,
} from "../schema.ts";
import { hintLikeGroups, likeArg } from "./hint-match.ts";
import { rowToSaved } from "./mapping.ts";
import { findByRefBase, prepareStatements } from "./statements.ts";
import { BULK_CANCEL_MAX, type EventStore } from "./types.ts";

// #224 — a DB-layer-local date helper. A near-identical addDaysIso lives in core/handler/shared/dates.ts,
// but the db layer must not import from core/handler (wrong dependency direction), and core/time.ts's variant
// returns a full RFC3339 instant, not a calendar day — so a small local copy is deliberate here.
/** Add `days` to a `YYYY-MM-DD` date in UTC (handles month/year rollover), return `YYYY-MM-DD`. */
function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** #224 — the last date a standing daily reminder surfaces: anchor + the window, hard-capped at the max. */
function standingUntil(anchorIso: string): string {
  return addDaysIso(anchorIso, Math.min(STANDING_WINDOW_DAYS, STANDING_MAX_DAYS));
}

// Public surface of the SQLite EventStore (split out of the former 424-LOC event-store.ts; see
// docs/refactor/server-decomposition-plan.md, P1). The pure/security-relevant pieces are isolated:
// types.ts (the contract), mapping.ts (row→SavedEvent), hint-match.ts (the FROZEN LIKE tokenizer),
// statements.ts (the prepared-statement block); the factory + its read/write methods stay here.
export type { EventMeta, EventPatch, EventStore, SavedEvent } from "./types.ts";
export { BULK_CANCEL_MAX } from "./types.ts";

// node:sqlite is a newer builtin that bundlers (Vite/Vitest) don't externalize cleanly;
// loading it via createRequire keeps it a runtime resolution Node handles directly.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

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
  // #19: same idempotent add for the open/done status column (DEFAULT 'open' backfills legacy rows).
  if (!cols.some((c) => c.name === "status")) db.exec(ADD_EVENTS_STATUS);
  // #224: same self-healing add for the standing-reminder columns (both nullable — non-standing rows stay null).
  if (!cols.some((c) => c.name === "standing_cadence")) db.exec(ADD_EVENTS_STANDING_CADENCE);
  if (!cols.some((c) => c.name === "standing_until")) db.exec(ADD_EVENTS_STANDING_UNTIL);

  const stmts = prepareStatements(db);

  return {
    saveEvent(event, meta) {
      // #224 — a standing daily reminder gets a bounded window (anchor + STANDING_WINDOW_DAYS); every other
      // row leaves both columns null. `standing` is deterministic (the parser's lexical gate set it), so we
      // trust it here. Only `daily` is a valid cadence in slice 1.
      const isStandingDaily = event.standing?.cadence === "daily";
      const row = stmts.insert.get(
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
        isStandingDaily ? "daily" : null,
        isStandingDaily ? standingUntil(event.date_iso) : null,
      ) as unknown as EventRow;
      return rowToSaved(row);
    },
    listEvents() {
      return (stmts.selectAll.all() as unknown as EventRow[]).map(rowToSaved);
    },
    deleteLastFromSender(fromPhone) {
      return Number(stmts.deleteLast.run(fromPhone, fromPhone).changes);
    },
    countSince(sinceIso) {
      return Number((stmts.countSinceStmt.get(sinceIso) as { c: number }).c);
    },
    deleteByProvider(provider) {
      return Number(stmts.deleteByProviderStmt.run(provider).changes);
    },
    deleteById(id, _familyId) {
      // _familyId is the reserved contract — family-scope today is "board rows only" (above).
      return Number(stmts.deleteByIdStmt.run(id).changes);
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
    searchEvents(_familyId, query) {
      // Same date/time base as findEventsByRef, but each title-hint word-variant matches ANY of the three
      // text columns (title/location/assignee) — so a reference whose disambiguator is the location or the
      // assignee resolves. Variants OR within a word; words AND across (a multi-word ref must match every
      // word in SOME column). All LIKEs are ESCAPE '\' so a literal %/_ can't broaden a destructive match.
      const params: (string | null)[] = [
        query.dateIso ?? null,
        query.dateIso ?? null,
        query.time ?? null,
        query.time ?? null,
      ];
      let groups = query.titleHint ? hintLikeGroups(query.titleHint) : [];
      if (query.titleHint && groups.length === 0) groups = [[likeArg(query.titleHint.trim())]];
      const variantClause =
        "(title_he LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\' OR assignee LIKE ? ESCAPE '\\')";
      const titleSql = groups
        .map((variants) => `(${variants.map(() => variantClause).join(" OR ")})`)
        .join(" AND ");
      // Three columns per variant ⇒ push each variant value three times, in clause order.
      for (const variants of groups) for (const v of variants) params.push(v, v, v);
      const sql = `${findByRefBase}${titleSql ? ` AND ${titleSql}` : ""} ORDER BY id DESC LIMIT 5;`;
      const rows = db.prepare(sql).all(...params) as unknown as EventRow[];
      return rows.map(rowToSaved);
    },
    findEventsInScope(_familyId, scope) {
      // Defense-in-depth (review #168/F1): an EMPTY scope would match every board row — for a destructive
      // bulk op the seam must be self-protecting, not rely on the caller's guard. `extractBulkCancel`
      // already requires a date/time, so this returns [] only for a misuse, never on the real path.
      if (!scope.dateIso && !scope.time) return [];
      // Same date/time base as findEventsByRef, but NO title clause — bulk cancel matches the whole scope
      // regardless of title/kind. BULK_CANCEL_MAX (not 5) so a busy day is fully listed; the literal is a
      // trusted constant (never user input), so interpolating it is injection-safe.
      const params: (string | null)[] = [
        scope.dateIso ?? null,
        scope.dateIso ?? null,
        scope.time ?? null,
        scope.time ?? null,
      ];
      const sql = `${findByRefBase} ORDER BY id DESC LIMIT ${BULK_CANCEL_MAX};`;
      const rows = db.prepare(sql).all(...params) as unknown as EventRow[];
      return rows.map(rowToSaved);
    },
    remindersDueOn(_familyId, dateIso) {
      // The date `?` is bound three times: the one-shot `date_iso = ?` plus the standing window bounds
      // (`date_iso <= ?` AND `standing_until >= ?`) — see remindersDueStmt.
      const rows = stmts.remindersDueStmt.all(dateIso, dateIso, dateIso) as unknown as EventRow[];
      return rows.map(rowToSaved);
    },
    findSlotConflict(_familyId, slot) {
      const row = stmts.findSlotStmt.get(
        slot.dateIso,
        slot.time,
        slot.excludeWaMessageId,
      ) as unknown as EventRow | undefined;
      return row ? rowToSaved(row) : null;
    },
    updateEvent(id, patch, _familyId) {
      const row = stmts.selectBoardByIdStmt.get(id) as unknown as EventRow | undefined;
      if (!row) return null; // not a board row (synced / nonexistent) → no write
      // Merge the patch onto the current row, then re-validate the WHOLE candidate (G20). zod strips
      // the `id`/`source_provider` extras; an invalid field (e.g. a bad date) fails → null, no write.
      const parsed = parsedEventSchema.safeParse({ ...rowToSaved(row), ...patch });
      if (!parsed.success) return null;
      const e = parsed.data;
      // #224 — re-sync the standing columns from the merged event so an EDIT that moves the date RE-ANCHORS
      // the window (was: standing_until stayed on the old anchor → the daily reminder silently died while the
      // confirm still said "יומי"). `standing` is preserved from the row through rowToSaved unless the patch
      // changes it.
      const isStandingDaily = e.standing?.cadence === "daily";
      const updated = stmts.updateByIdStmt.get(
        e.kind,
        e.title_he,
        e.date_iso,
        e.time,
        e.location,
        e.assignee,
        e.recurrence?.freq ?? null,
        e.recurrence?.weekday ?? null,
        isStandingDaily ? "daily" : null,
        isStandingDaily ? standingUntil(e.date_iso) : null,
        id,
      ) as unknown as EventRow;
      return rowToSaved(updated);
    },
    setEventStatus(id, status, _familyId) {
      // _familyId is the reserved Phase-8 contract; family-scope today is "board rows only" (the
      // source_provider IS NULL in setStatusStmt). A synced/nonexistent row RETURNs nothing → null.
      const row = stmts.setStatusStmt.get(status, id) as unknown as EventRow | undefined;
      return row ? rowToSaved(row) : null;
    },
  };
}
