import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { InboundOutcome } from "@homeos/shared";
import type { InboundMessage } from "../http/webhook.ts";
import { ADD_INBOUND_OUTCOME, CREATE_INBOUND_TABLE, type InboundRow } from "./schema.ts";

// node:sqlite is a newer builtin that bundlers (Vite/Vitest) don't externalize cleanly;
// loading it via createRequire keeps it a runtime resolution Node handles directly.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/**
 * The inbound queue seam (item A: "make the DB the queue"). The webhook persists here BEFORE
 * acking 200, so the message survives a crash/redeploy; `enqueue` doubles as the durable
 * dedupe via the wa_message_id PRIMARY KEY. Boot-replay re-runs anything still `pending`.
 */
export interface InboundStats {
  done: number;
  failed: number;
  pending: number;
}

export interface InboundStore {
  /** Persist a new inbound as 'pending'. Returns false if already seen (duplicate → skip). */
  enqueue(msg: InboundMessage): boolean;
  /**
   * Settle a row as 'done'. #135 — the optional `outcome` records the FINER terminal disposition the
   * handler reached (parsed/clarified/rephrase/…); omit it for command paths (ביטול/sync/cancel/edit),
   * which leave `outcome` null. The `outcome` write is the one place the disposition lands.
   */
  markDone(id: string, outcome?: InboundOutcome): void;
  markFailed(id: string): void;
  /** Inbounds persisted but never finished (the crash window) — replayed on boot. */
  pending(): InboundMessage[];
  /**
   * #135 [D2] — the most recent inbound rows (raw, newest-first), capped at `limit`. Backs the
   * `GET /messages` feed; returns full {@link InboundRow}s (text/status/outcome/timestamps), which the
   * endpoint maps to the served DTO. Read-only; an append-only audit surface.
   *
   * `fromPhones` (optional) scopes to those senders via a SQL `WHERE from_phone IN (…)` so the `limit`
   * applies AFTER filtering — a burst of pre-allowlist spam can't crowd the family's rows out of the
   * feed (review F1). Pass digit-normalized numbers (the column holds Meta's digit form). Omitted ⇒ no
   * filter (every row); an empty array ⇒ no rows (an empty allowlist serves nothing, matching isAllowed).
   */
  listRecent(limit: number, fromPhones?: readonly string[]): InboundRow[];
  /** Status counts for inbounds received at/after `sinceIso` (SQLite UTC datetime). Feeds the daily digest. */
  statsSince(sinceIso: string): InboundStats;
  /**
   * Count one sender's inbound messages received at/after `sinceIso` (SQLite UTC datetime). Backs
   * the G16 per-sender daily ceiling — the message is persisted before processing, so the current
   * one is included in the count.
   */
  countFromSenderSince(fromPhone: string, sinceIso: string): number;
}

function rowToMsg(row: InboundRow): InboundMessage {
  return {
    id: row.wa_message_id,
    from: row.from_phone,
    type: row.type,
    ...(row.text !== null ? { text: row.text } : {}),
  };
}

/**
 * SQLite-backed InboundStore (node:sqlite). Opens its own connection to the same DB file as
 * the EventStore — both share the one family file; WAL handles the two connections. Pass
 * ":memory:" in tests.
 */
export function createInboundStore(dbPath: string): InboundStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_INBOUND_TABLE);
  // #135: ensure `outcome` exists on a pre-existing inbound_messages table (CREATE IF NOT EXISTS won't
  // add it). Fresh DBs get it from the DDL; older DBs get it here (mirrors event-store.ts:169-171).
  const cols = db.prepare("PRAGMA table_info(inbound_messages);").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "outcome")) db.exec(ADD_INBOUND_OUTCOME);

  const insert = db.prepare(
    `INSERT INTO inbound_messages (wa_message_id, from_phone, type, text)
     VALUES (?, ?, ?, ?) ON CONFLICT(wa_message_id) DO NOTHING;`,
  );
  // #135: markDone also writes `outcome` (null when omitted — command paths); markFailed leaves it null.
  const setDone = db.prepare(
    "UPDATE inbound_messages SET status = 'done', processed_at = datetime('now'), outcome = ? WHERE wa_message_id = ?;",
  );
  const setFailed = db.prepare(
    "UPDATE inbound_messages SET status = 'failed', processed_at = datetime('now') WHERE wa_message_id = ?;",
  );
  const selectPending = db.prepare(
    "SELECT * FROM inbound_messages WHERE status = 'pending' ORDER BY received_at, rowid;",
  );
  // #135: newest-first by received_at (rowid breaks ties — insertion order within the same second).
  const selectRecent = db.prepare(
    "SELECT * FROM inbound_messages ORDER BY received_at DESC, rowid DESC LIMIT ?;",
  );
  const statsStmt = db.prepare(
    "SELECT status, COUNT(*) AS c FROM inbound_messages WHERE received_at >= ? GROUP BY status;",
  );
  const countFromSenderStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM inbound_messages WHERE from_phone = ? AND received_at >= ?;",
  );

  return {
    enqueue(msg) {
      const res = insert.run(msg.id, msg.from, msg.type, msg.text ?? null);
      return Number(res.changes) === 1; // 0 changes → conflict → already seen
    },
    markDone(id, outcome) {
      setDone.run(outcome ?? null, id);
    },
    markFailed(id) {
      setFailed.run(id);
    },
    pending() {
      return (selectPending.all() as unknown as InboundRow[]).map(rowToMsg);
    },
    listRecent(limit, fromPhones) {
      if (fromPhones === undefined) {
        return selectRecent.all(limit) as unknown as InboundRow[];
      }
      if (fromPhones.length === 0) return []; // empty allowlist → serve nothing (no `IN ()`)
      // Filter IN SQL so LIMIT applies to the kept rows (F1). The IN-arity varies, so this stmt is
      // built per call (the /messages feed is low-traffic — no hot-path prepare-cache needed).
      const placeholders = fromPhones.map(() => "?").join(", ");
      const stmt = db.prepare(
        `SELECT * FROM inbound_messages WHERE from_phone IN (${placeholders})
         ORDER BY received_at DESC, rowid DESC LIMIT ?;`,
      );
      return stmt.all(...fromPhones, limit) as unknown as InboundRow[];
    },
    statsSince(sinceIso) {
      const rows = statsStmt.all(sinceIso) as unknown as Array<{ status: string; c: number }>;
      const stats: InboundStats = { done: 0, failed: 0, pending: 0 };
      for (const row of rows) {
        if (row.status === "done") stats.done = Number(row.c);
        else if (row.status === "failed") stats.failed = Number(row.c);
        else if (row.status === "pending") stats.pending = Number(row.c);
      }
      return stats;
    },
    countFromSenderSince(fromPhone, sinceIso) {
      return Number((countFromSenderStmt.get(fromPhone, sinceIso) as { c: number }).c);
    },
  };
}
