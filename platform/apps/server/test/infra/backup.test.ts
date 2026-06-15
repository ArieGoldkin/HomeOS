import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedEvent } from "@homeos/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventStore } from "../../src/db/event-store.ts";
import { backupDatabase, type Uploader } from "../../src/infra/backup.ts";

const event: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: null,
  recurrence: null,
  source_text: "אסיפת הורים",
};

describe("backupDatabase (WAL-safe snapshot)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "homeos-backup-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("snapshots the live DB via VACUUM INTO and hands it to the uploader", async () => {
    const dbPath = join(dir, "homeos.db");
    const store = createEventStore(dbPath);
    store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.1" });

    const upload = vi.fn(async (_localPath: string, _key: string) => {});
    const uploader: Uploader = { upload };

    const dest = await backupDatabase(dbPath, uploader, { tmpDir: dir });

    // The uploader received the snapshot path + a key.
    expect(upload).toHaveBeenCalledTimes(1);
    const [localPath, key] = upload.mock.calls[0]!;
    expect(localPath).toBe(dest);
    expect(key).toMatch(/^homeos-.*\.db$/);

    // The snapshot is a valid, consistent DB containing the row (not an empty/torn copy).
    const snapshot = createEventStore(dest);
    expect(snapshot.listEvents()).toHaveLength(1);
    expect(snapshot.listEvents()[0]!.title_he).toBe("אסיפת הורים");
  });
});
