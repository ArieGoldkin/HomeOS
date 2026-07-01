import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { CREATE_BOARD_READS_TABLE } from "./schema.ts";

// node:sqlite is a newer builtin bundlers don't externalize cleanly — load via createRequire (as the
// other stores do) so Node resolves it directly at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/**
 * #26 — the dogfood engagement store: a per-day board-read tally over the shared family DB file. It owns
 * ONLY the `board_reads` table and records COUNTS (no user, no PII) — the "daily glance" signal the Phase-6
 * exit gate reads. Its own `node:sqlite` connection on the same file as the other stores (WAL handles it).
 */
export interface MetricsStore {
  /** Increment today's (UTC) board-read tally by one. Called on each session-gated `GET /events`. */
  recordBoardRead(): void;
  /** How many DISTINCT days at/after `since` (a YYYY-MM-DD or SQLite datetime) had ≥1 board read. */
  boardReadDaysSince(since: string): number;
}

export function createMetricsStore(dbPath: string): MetricsStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(CREATE_BOARD_READS_TABLE);

  // Upsert on the day PK: first read of the day inserts (count 1), subsequent reads bump it.
  const recordStmt = db.prepare(
    "INSERT INTO board_reads (day, count) VALUES (date('now'), 1) " +
      "ON CONFLICT(day) DO UPDATE SET count = count + 1;",
  );
  // `date(?)` normalizes a datetime arg to its calendar day, so a since of either form compares correctly.
  const daysSinceStmt = db.prepare(
    "SELECT COUNT(*) AS c FROM board_reads WHERE day >= date(?) AND count > 0;",
  );

  return {
    recordBoardRead() {
      recordStmt.run();
    },
    boardReadDaysSince(since) {
      return Number((daysSinceStmt.get(since) as { c: number }).c);
    },
  };
}
