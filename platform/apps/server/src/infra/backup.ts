import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scheduleDaily } from "../core/scheduler.ts";

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
  /** Hour of day (0–23) to run, Asia/Jerusalem. */
  hour: number;
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

  await uploader.upload(dest, key);
  return dest;
}

/** Run one backup, logging the outcome (failure surfaces via the logs / daily digest). */
export async function runBackupOnce(deps: BackupDeps): Promise<void> {
  const dest = await backupDatabase(deps.dbPath, deps.uploader, {
    now: deps.now,
    tmpDir: deps.tmpDir,
  });
  deps.log?.("nightly backup uploaded", { dest });
  // #61/MF4: age out old offsite snapshots (defense-in-depth on the encrypted-token-in-backup path).
  const now = (deps.now ?? (() => new Date()))();
  await deps.uploader.prune?.(deps.retentionDays ?? DEFAULT_RETENTION_DAYS, now);
}

/** Schedule the nightly backup at `hour` Asia/Jerusalem — via the shared scheduler. */
export function scheduleBackup(deps: BackupDeps): { stop: () => void } {
  return scheduleDaily(deps.hour, () => runBackupOnce(deps), {
    now: deps.now,
    onError: (err) => deps.log?.("backup failed", { error: String(err) }),
  });
}
