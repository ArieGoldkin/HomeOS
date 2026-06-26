import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedEvent } from "@homeos/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ConversationPayload,
  cancelPayloadSchema,
  createConversationStore,
  editPayloadSchema,
} from "../../src/db/conversation-store.ts";
import { BULK_CANCEL_MAX } from "../../src/db/event-store.ts";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const draft: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: null,
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "אסיפת הורים ביום ראשון",
};
const clarifyPayload: ConversationPayload = { kind: "clarify", reason: "missing_time", draft };

const A = "972500000001";
const B = "972500000002";
// expiresAt = 12:30; a "now" before it is valid, after it is expired (TTL checked at read).
const EXPIRES_AT = "2026-06-20 12:30:00";
const BEFORE = "2026-06-20 12:15:00";
const AFTER = "2026-06-20 12:45:00";

const tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "homeos-conv-"));
  tmpDirs.push(dir);
  return join(dir, "test.db");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("ConversationStore", () => {
  it("create → getPending round-trips the pending row", () => {
    const store = createConversationStore(":memory:");
    const created = store.create({
      fromPhone: A,
      payload: clarifyPayload,
      expiresAt: EXPIRES_AT,
    });
    expect(created.from_phone).toBe(A);
    expect(created.kind).toBe("clarify");
    expect(created.status).toBe("pending");

    const pending = store.getPending(A, BEFORE);
    expect(pending?.id).toBe(created.id);
    expect(JSON.parse(pending?.payload_json ?? "null")).toEqual(clarifyPayload);
  });

  it("a second create for the same sender overwrites the prior pending row (one thread per sender)", () => {
    const store = createConversationStore(":memory:");
    store.create({ fromPhone: A, payload: clarifyPayload, expiresAt: EXPIRES_AT });
    const second = store.create({
      fromPhone: A,
      payload: { ...clarifyPayload, reason: "missing_date" },
      expiresAt: EXPIRES_AT,
    });

    const pending = store.getPending(A, BEFORE);
    expect(pending?.id).toBe(second.id);
    expect(JSON.parse(pending?.payload_json ?? "null").reason).toBe("missing_date");
  });

  it("two senders hold independent threads", () => {
    const store = createConversationStore(":memory:");
    store.create({ fromPhone: A, payload: clarifyPayload, expiresAt: EXPIRES_AT });
    store.create({ fromPhone: B, payload: clarifyPayload, expiresAt: EXPIRES_AT });

    const a = store.getPending(A, BEFORE);
    expect(a).not.toBeNull();
    expect(store.getPending(B, BEFORE)).not.toBeNull();

    store.resolve(a?.id ?? -1);
    expect(store.getPending(A, BEFORE)).toBeNull(); // A resolved
    expect(store.getPending(B, BEFORE)).not.toBeNull(); // B untouched
  });

  it("getPending returns null for an expired row (TTL checked at read, row still present)", () => {
    const store = createConversationStore(":memory:");
    store.create({ fromPhone: A, payload: clarifyPayload, expiresAt: EXPIRES_AT });
    expect(store.getPending(A, AFTER)).toBeNull(); // now > expiresAt → invisible
    expect(store.getPending(A, BEFORE)).not.toBeNull(); // not swept, just hidden when expired
  });

  it("resolve is single-use (DELETE…RETURNING): a redelivered answer finds no pending row", () => {
    const store = createConversationStore(":memory:");
    const created = store.create({
      fromPhone: A,
      payload: clarifyPayload,
      expiresAt: EXPIRES_AT,
    });
    const resolved = store.resolve(created.id);
    expect(resolved?.id).toBe(created.id);
    expect(store.resolve(created.id)).toBeNull(); // redelivery → already gone (no-op)
    expect(store.getPending(A, BEFORE)).toBeNull();
  });

  it("expireStale sweeps expired rows, returns the count, and leaves fresh ones", () => {
    const store = createConversationStore(":memory:");
    store.create({
      fromPhone: A,
      payload: clarifyPayload,
      expiresAt: "2026-06-20 12:10:00",
    });
    store.create({
      fromPhone: B,
      payload: clarifyPayload,
      expiresAt: "2026-06-20 13:00:00",
    });

    const swept = store.expireStale("2026-06-20 12:30:00");
    expect(swept).toBe(1);
    expect(store.getPending(A, "2026-06-20 12:05:00")).toBeNull(); // A deleted outright
    expect(store.getPending(B, "2026-06-20 12:30:00")).not.toBeNull(); // B survives
  });
});

describe("editPayloadSchema + create derives kind (#86)", () => {
  it("validates an edit payload and rejects a bad patch field", () => {
    expect(
      editPayloadSchema.safeParse({ kind: "edit", candidateIds: [1, 2], patch: { time: "16:00" } })
        .success,
    ).toBe(true);
    expect(
      editPayloadSchema.safeParse({ kind: "edit", candidateIds: [1], patch: { date_iso: "nope" } })
        .success,
    ).toBe(false);
  });

  it("create() derives the row kind from the edit payload's discriminant", () => {
    const store = createConversationStore(":memory:");
    const row = store.create({
      fromPhone: "972500000009",
      payload: { kind: "edit", candidateIds: [7], patch: { time: "18:00" } },
      expiresAt: "2026-06-20 12:00:00",
    });
    expect(row.kind).toBe("edit");
  });
});

describe("cancelPayloadSchema — #163 bulk-cancel (confirmAll + raised cap)", () => {
  it("accepts a confirmAll bulk payload with MORE than 5 ids (up to BULK_CANCEL_MAX)", () => {
    const ids = Array.from({ length: 8 }, (_, i) => i + 1); // 8 > the old cap of 5
    expect(
      cancelPayloadSchema.safeParse({ kind: "cancel", candidateIds: ids, confirmAll: true }),
    ).toMatchObject({ success: true });
    // still capped — BULK_CANCEL_MAX + 1 ids is rejected
    const tooMany = Array.from({ length: BULK_CANCEL_MAX + 1 }, (_, i) => i + 1);
    expect(cancelPayloadSchema.safeParse({ kind: "cancel", candidateIds: tooMany }).success).toBe(
      false,
    );
  });

  it("keeps confirmAll OPTIONAL — a plain disambiguation payload (no flag) still validates", () => {
    expect(cancelPayloadSchema.safeParse({ kind: "cancel", candidateIds: [1, 2] }).success).toBe(
      true,
    );
  });

  it("a bulk thread round-trips through create() with kind=cancel", () => {
    const store = createConversationStore(":memory:");
    const row = store.create({
      fromPhone: "972500000010",
      payload: { kind: "cancel", candidateIds: [1, 2, 3, 4, 5, 6], confirmAll: true },
      expiresAt: "2026-06-20 12:00:00",
    });
    expect(row.kind).toBe("cancel");
    const parsed = cancelPayloadSchema.safeParse(JSON.parse(row.payload_json));
    expect(parsed.success && parsed.data.confirmAll).toBe(true);
    expect(parsed.success && parsed.data.candidateIds).toHaveLength(6);
  });
});

describe("#232 — family_id column + UNIQUE(family_id, from_phone)", () => {
  it("create() writes family_id = 'default' (the column exists and backfills at N=1)", () => {
    const store = createConversationStore(":memory:");
    const row = store.create({ fromPhone: A, payload: clarifyPayload, expiresAt: EXPIRES_AT });
    expect(row.family_id).toBe("default");
  });

  it("the composite key lets two families hold a pending thread for the SAME phone (no REPLACE collision)", () => {
    const path = tmpDbPath();
    createConversationStore(path); // builds the table + the composite (family_id, from_phone) index
    // The store API only ever writes family_id='default'; reach past it with raw SQL to prove the
    // constraint itself doesn't collapse two tenants — the corruption vector #232 closes pre-#229.
    const raw = new DatabaseSync(path);
    const ins = raw.prepare(
      `INSERT OR REPLACE INTO conversations (family_id, from_phone, kind, payload_json, expires_at)
       VALUES (?, ?, 'clarify', '{}', ?);`,
    );
    ins.run("default", A, EXPIRES_AT);
    ins.run("family-2", A, EXPIRES_AT); // same phone, different family — must NOT replace the first
    const rows = raw
      .prepare("SELECT family_id FROM conversations WHERE from_phone = ? ORDER BY family_id;")
      .all(A) as Array<{ family_id: string }>;
    expect(rows.map((r) => r.family_id)).toEqual(["default", "family-2"]); // both coexist
  });

  it("migrates a PRE-#232 table: adds family_id (backfilled 'default') + pivots the index, idempotently", () => {
    const path = tmpDbPath();
    // Hand-build the OLD schema: no family_id, single-column unique index, one existing row.
    const old = new DatabaseSync(path);
    old.exec("PRAGMA journal_mode = WAL;");
    old.exec(`CREATE TABLE conversations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      from_phone   TEXT    NOT NULL,
      kind         TEXT    NOT NULL,
      payload_json TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      expires_at   TEXT    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );`);
    old.exec(
      "CREATE UNIQUE INDEX conversations_one_pending_per_sender ON conversations(from_phone);",
    );
    old
      .prepare(
        "INSERT INTO conversations (from_phone, kind, payload_json, expires_at) VALUES (?, 'clarify', '{}', ?);",
      )
      .run(A, EXPIRES_AT);

    // Opening the store runs the migration.
    const store = createConversationStore(path);
    const probe = new DatabaseSync(path);

    const cols = probe.prepare("PRAGMA table_info(conversations);").all() as Array<{
      name: string;
    }>;
    expect(cols.some((c) => c.name === "family_id")).toBe(true);

    const backfilled = probe
      .prepare("SELECT family_id FROM conversations WHERE from_phone = ?;")
      .get(A) as { family_id: string };
    expect(backfilled.family_id).toBe("default"); // the pre-existing row is backfilled

    const idxCols = probe
      .prepare("PRAGMA index_info(conversations_one_pending_per_sender);")
      .all() as Array<{ name: string }>;
    expect(idxCols.map((c) => c.name)).toEqual(["family_id", "from_phone"]); // pivoted to composite

    expect(store.getPending(A, BEFORE)).not.toBeNull(); // store still works on the migrated DB
    expect(() => createConversationStore(path)).not.toThrow(); // re-running the migration is a no-op
  });

  it("self-heals a partial migration — family_id present but the index still single-column → re-pivots", () => {
    const path = tmpDbPath();
    // Simulate a crash BETWEEN add-column and the index pivot: column exists, old (from_phone) index.
    const partial = new DatabaseSync(path);
    partial.exec("PRAGMA journal_mode = WAL;");
    partial.exec(`CREATE TABLE conversations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id    TEXT    NOT NULL DEFAULT 'default',
      from_phone   TEXT    NOT NULL,
      kind         TEXT    NOT NULL,
      payload_json TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      expires_at   TEXT    NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );`);
    partial.exec(
      "CREATE UNIQUE INDEX conversations_one_pending_per_sender ON conversations(from_phone);",
    );

    createConversationStore(path); // shape-keyed guard must re-pivot, not skip (column already present)
    const idxCols = new DatabaseSync(path)
      .prepare("PRAGMA index_info(conversations_one_pending_per_sender);")
      .all() as Array<{ name: string }>;
    expect(idxCols.map((c) => c.name)).toEqual(["family_id", "from_phone"]);
  });
});
