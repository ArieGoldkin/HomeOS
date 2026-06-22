import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import {
  type ConversationPayload,
  cancelPayloadSchema,
  createConversationStore,
  editPayloadSchema,
} from "../../src/db/conversation-store.ts";
import { BULK_CANCEL_MAX } from "../../src/db/event-store.ts";

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
