import { describe, it, expect } from "vitest";
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
});
