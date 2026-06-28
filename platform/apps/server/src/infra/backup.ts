import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduleEvery } from "../core/scheduler.ts";

// node:sqlite is a newer builtin that bundlers (Vite/Vitest) don't externalize cleanly;
// loading it via createRequire keeps it a runtime resolution Node handles directly.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

/**
 * Where a backup snapshot is sent offsite. Kept as an interface so the WAL-safe snapshot logic is
 * testable without cloud creds; the production impl (R2/B2 via an S3-compatible client) is wired
 * at the Railway cutover. `noopUploader` keeps local dev a no-op.
 */
export interface Uploader {
  upload(localPath: string, key: string): Promise<void>;
  /**
   * Optional (#61/MF4): delete offsite snapshots older than `retentionDays`, so a disconnected
   * family's encrypted token ages out of backups (revoke at Google is the PRIMARY kill-switch; this is
   * defense-in-depth). The real R2/B2 impl wires this at the Railway cutover; `noopUploader` skips it.
   */
  prune?(retentionDays: number, now: Date): Promise<void>;
  /**
   * Optional (#134): timestamp of the newest offsite snapshot, or `null` if none exist. Read from the
   * store itself (not in-process state) so the freshness alert survives restarts. The daily digest
   * uses this to warn when the offsite copy has gone stale; `noopUploader` skips it (dev never alerts).
   */
  latestUploadAt?(): Promise<Date | null>;
}

/** Default offsite-snapshot retention window (#61/MF4). */
export const DEFAULT_RETENTION_DAYS = 14;

export const noopUploader: Uploader = {
  async upload() {
    /* local dev: nothing to send offsite */
  },
};

export interface BackupDeps {
  dbPath: string;
  uploader: Uploader;
  /** Offsite-snapshot retention window in days (#61/MF4); defaults to DEFAULT_RETENTION_DAYS. */
  retentionDays?: number;
  now?: () => Date;
  /** Directory for the temporary snapshot (default: OS tmp). */
  tmpDir?: string;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Take a WAL-safe snapshot of the SQLite DB and hand it to the uploader. Uses `VACUUM INTO`
 * (NOT a naked file copy) so the snapshot is a consistent point-in-time DB even though we're in
 * WAL mode with concurrent writers. Returns the local snapshot path.
 */
export async function backupDatabase(
  dbPath: string,
  uploader: Uploader,
  opts: { now?: () => Date; tmpDir?: string } = {},
): Promise<string> {
  const now = (opts.now ?? (() => new Date()))();
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-"); // YYYY-MM-DD-HH-MM-SS
  const key = `homeos-${stamp}.db`;
  const dest = join(opts.tmpDir ?? tmpdir(), key);

  rmSync(dest, { force: true }); // VACUUM INTO fails if the target already exists
  const db = new DatabaseSync(dbPath);
  try {
    // Single-quote-escape the path; it's controlled (tmp dir + timestamp), no user input.
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  try {
    await uploader.upload(dest, key);
  } catch (err) {
    // Don't leak the full-DB snapshot in tmp if the upload failed (a repeatedly-failing upload would
    // otherwise fill the disk one DB-copy per cycle). The caller still gets the error.
    rmSync(dest, { force: true });
    throw err;
  }
  return dest;
}

/** Run one backup, logging the outcome (failure surfaces via the logs / daily digest). */
export async function runBackupOnce(deps: BackupDeps): Promise<void> {
  const dest = await backupDatabase(deps.dbPath, deps.uploader, {
    now: deps.now,
    tmpDir: deps.tmpDir,
  });
  try {
    deps.log?.("offsite backup uploaded", { dest });
    // #61/MF4: age out old offsite snapshots (defense-in-depth on the encrypted-token-in-backup path).
    const now = (deps.now ?? (() => new Date()))();
    await deps.uploader.prune?.(deps.retentionDays ?? DEFAULT_RETENTION_DAYS, now);
  } finally {
    // The offsite copy is what we keep; the local snapshot is transient. Remove it so successive
    // runs (every BACKUP_INTERVAL_HOURS) don't accumulate full-DB copies in tmp.
    rmSync(dest, { force: true });
  }
}

/**
 * #134 — the staleness half of the freshness alert (the failure half is scheduleBackup's onError log).
 * Returns a Hebrew warning line when the newest offsite snapshot is MISSING or older than `maxAgeMs`,
 * else `null` — a healthy backup adds no noise (like the digest itself, only the *absence* of a good
 * state is the signal). The daily digest appends whatever this returns.
 */
export function backupFreshnessLine(
  lastUploadAt: Date | null,
  now: Date,
  maxAgeMs: number,
): string | null {
  if (lastUploadAt === null) return "⚠️ אין גיבוי עדכני באחסון החיצוני";
  const ageMs = now.getTime() - lastUploadAt.getTime();
  if (ageMs <= maxAgeMs) return null;
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  return `⚠️ הגיבוי לא עודכן מעל ${hours} שעות`;
}

/**
 * Schedule the offsite backup every `intervalMs` (#134 — a fixed cadence bounds the RPO, vs the
 * digest's wall-clock hour). A failed run is logged via `onError` (the structured failure half of the
 * freshness alert; the staleness half rides the daily digest) and the loop keeps running.
 */
export function scheduleBackup(deps: BackupDeps & { intervalMs: number }): { stop: () => void } {
  return scheduleEvery(deps.intervalMs, () => runBackupOnce(deps), {
    onError: (err) => deps.log?.("backup failed", { error: String(err) }),
  });
}
