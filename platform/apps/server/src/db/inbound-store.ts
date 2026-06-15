import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { InboundMessage } from "../http/webhook.ts";
import { CREATE_INBOUND_TABLE, type InboundRow } from "./schema.ts";

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
  markDone(id: string): void;
  markFailed(id: string): void;
  /** Inbounds persisted but never finished (the crash window) — replayed on boot. */
  pending(): InboundMessage[];
  /** Status counts for inbounds received at/after `sinceIso` (SQLite UTC datetime). Feeds the daily digest. */
  statsSince(sinceIso: string): InboundStats;
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

  const insert = db.prepare(
    `INSERT INTO inbound_messages (wa_message_id, from_phone, type, text)
     VALUES (?, ?, ?, ?) ON CONFLICT(wa_message_id) DO NOTHING;`,
  );
  const setStatus = db.prepare(
    "UPDATE inbound_messages SET status = ?, processed_at = datetime('now') WHERE wa_message_id = ?;",
  );
  const selectPending = db.prepare(
    "SELECT * FROM inbound_messages WHERE status = 'pending' ORDER BY received_at, rowid;",
  );
  const statsStmt = db.prepare(
    "SELECT status, COUNT(*) AS c FROM inbound_messages WHERE received_at >= ? GROUP BY status;",
  );

  return {
    enqueue(msg) {
      const res = insert.run(msg.id, msg.from, msg.type, msg.text ?? null);
      return Number(res.changes) === 1; // 0 changes → conflict → already seen
    },
    markDone(id) {
      setStatus.run("done", id);
    },
    markFailed(id) {
      setStatus.run("failed", id);
    },
    pending() {
      return (selectPending.all() as unknown as InboundRow[]).map(rowToMsg);
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
  };
}
