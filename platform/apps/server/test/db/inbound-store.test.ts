import { describe, expect, it } from "vitest";
import { createInboundStore } from "../../src/db/inbound-store.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";

const msg: InboundMessage = { id: "wamid.1", from: "972501234567", type: "text", text: "שלום" };

describe("InboundStore (in-memory SQLite)", () => {
  it("enqueues a new message as pending and returns true", () => {
    const store = createInboundStore(":memory:");
    expect(store.enqueue(msg)).toBe(true);
    expect(store.pending()).toHaveLength(1);
    expect(store.pending()[0]).toEqual(msg);
  });

  it("dedupes on wa_message_id — a duplicate delivery returns false and adds no row", () => {
    const store = createInboundStore(":memory:");
    expect(store.enqueue(msg)).toBe(true);
    expect(store.enqueue(msg)).toBe(false); // Meta at-least-once retry → skip
    expect(store.pending()).toHaveLength(1);
  });

  it("dedupe survives across store instances on the same file (restart-safe)", () => {
    // Two instances over the same path stand in for a process restart.
    const path = `/tmp/homeos-inbound-test-${Date.now()}.db`;
    const a = createInboundStore(path);
    expect(a.enqueue(msg)).toBe(true);
    const b = createInboundStore(path);
    expect(b.enqueue(msg)).toBe(false); // already seen before the "restart"
  });

  it("markDone removes the message from the replay set", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    store.markDone(msg.id);
    expect(store.pending()).toHaveLength(0);
  });

  it("markFailed removes it from pending (failed is terminal, not auto-replayed)", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    store.markFailed(msg.id);
    expect(store.pending()).toHaveLength(0);
  });

  it("omits text for a non-text message", () => {
    const store = createInboundStore(":memory:");
    store.enqueue({ id: "wamid.img", from: "9725", type: "image" });
    expect(store.pending()[0]).toEqual({ id: "wamid.img", from: "9725", type: "image" });
  });

  it("statsSince counts by status (done/failed/pending) within the window", () => {
    const store = createInboundStore(":memory:");
    store.enqueue({ ...msg, id: "a" });
    store.enqueue({ ...msg, id: "b" });
    store.enqueue({ ...msg, id: "c" });
    store.enqueue({ ...msg, id: "d" }); // stays pending
    store.markDone("a");
    store.markDone("b");
    store.markFailed("c");
    expect(store.statsSince("2000-01-01 00:00:00")).toEqual({ done: 2, failed: 1, pending: 1 });
  });

  it("statsSince excludes rows received before the cutoff", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    store.markDone(msg.id);
    expect(store.statsSince("2999-01-01 00:00:00")).toEqual({ done: 0, failed: 0, pending: 0 });
  });

  it("countFromSenderSince counts only the given sender's rows within the window (G16)", () => {
    const store = createInboundStore(":memory:");
    store.enqueue({ id: "a1", from: "972500000001", type: "text", text: "x" });
    store.enqueue({ id: "a2", from: "972500000001", type: "text", text: "y" });
    store.enqueue({ id: "b1", from: "972500000002", type: "text", text: "z" });
    expect(store.countFromSenderSince("972500000001", "2000-01-01 00:00:00")).toBe(2);
    expect(store.countFromSenderSince("972500000002", "2000-01-01 00:00:00")).toBe(1);
    expect(store.countFromSenderSince("972500000009", "2000-01-01 00:00:00")).toBe(0);
  });

  it("countFromSenderSince excludes rows received before the cutoff (day-boundary reset)", () => {
    const store = createInboundStore(":memory:");
    store.enqueue({ id: "a1", from: "972500000001", type: "text", text: "x" });
    expect(store.countFromSenderSince("972500000001", "2999-01-01 00:00:00")).toBe(0);
  });

  // #135 — markDone records the finer outcome; listRecent serves the raw feed (newest-first).
  it("markDone records the outcome on the row (read back via listRecent)", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    store.markDone(msg.id, "parsed");
    const [row] = store.listRecent(10);
    expect(row).toMatchObject({ wa_message_id: msg.id, status: "done", outcome: "parsed" });
  });

  it("markDone without an outcome leaves outcome null (command paths)", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    store.markDone(msg.id); // e.g. a ביטול / sync command — done, but not a parse
    expect(store.listRecent(10)[0]?.outcome).toBeNull();
  });

  it("a freshly-enqueued (pending) row has a null outcome", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    expect(store.listRecent(10)[0]).toMatchObject({ status: "pending", outcome: null });
  });

  it("markFailed leaves outcome null (a failure is a status, not a disposition)", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    store.markFailed(msg.id);
    expect(store.listRecent(10)[0]).toMatchObject({ status: "failed", outcome: null });
  });

  it("listRecent returns rows newest-first", () => {
    const store = createInboundStore(":memory:");
    store.enqueue({ ...msg, id: "old" });
    store.enqueue({ ...msg, id: "new" });
    expect(store.listRecent(10).map((r) => r.wa_message_id)).toEqual(["new", "old"]);
  });

  it("listRecent caps at the given limit", () => {
    const store = createInboundStore(":memory:");
    for (const id of ["a", "b", "c", "d", "e"]) store.enqueue({ ...msg, id });
    expect(store.listRecent(3)).toHaveLength(3);
  });

  // #135 F1 — the allowlist filter is pushed into SQL so the LIMIT applies to the kept rows.
  it("listRecent(limit, fromPhones) returns only the given senders' rows", () => {
    const store = createInboundStore(":memory:");
    store.enqueue({ id: "fam", from: "972500000001", type: "text", text: "x" });
    store.enqueue({ id: "spam", from: "999", type: "text", text: "y" });
    expect(store.listRecent(10, ["972500000001"]).map((r) => r.wa_message_id)).toEqual(["fam"]);
  });

  it("listRecent applies the allowlist filter BEFORE the limit (spam can't crowd out family)", () => {
    const store = createInboundStore(":memory:");
    // the family row is enqueued FIRST (oldest), then 3 newer spam rows
    store.enqueue({ id: "fam", from: "972500000001", type: "text", text: "real" });
    for (const id of ["s1", "s2", "s3"])
      store.enqueue({ id, from: "999", type: "text", text: "spam" });
    // limit 2: an unfiltered query would return [s3, s2] and drop the family row entirely. With the
    // filter pushed into SQL, the family row survives despite being the oldest.
    expect(store.listRecent(2, ["972500000001"]).map((r) => r.wa_message_id)).toEqual(["fam"]);
  });

  it("listRecent with an empty allowlist serves nothing", () => {
    const store = createInboundStore(":memory:");
    store.enqueue(msg);
    expect(store.listRecent(10, [])).toEqual([]);
  });

  it("the outcome migration is idempotent across store instances on the same file", () => {
    // Two instances over the same path stand in for a restart — the second must NOT re-run the
    // ALTER (would throw "duplicate column"); it should detect the column and skip it.
    const path = `/tmp/homeos-inbound-outcome-${Date.now()}.db`;
    const a = createInboundStore(path);
    a.enqueue(msg);
    a.markDone(msg.id, "clarified");
    const b = createInboundStore(path); // re-open: migration guard must skip the ALTER
    expect(b.listRecent(10)[0]).toMatchObject({ outcome: "clarified" });
  });
});
