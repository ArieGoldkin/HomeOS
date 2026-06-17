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
});
