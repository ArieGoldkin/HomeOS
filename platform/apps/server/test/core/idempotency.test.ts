import { describe, it, expect } from "vitest";
import { createIdempotencyStore } from "../../src/core/idempotency.ts";

describe("createIdempotencyStore", () => {
  it("returns false for a new id and true on repeat", () => {
    const store = createIdempotencyStore();
    expect(store.seen("wamid.A")).toBe(false);
    expect(store.seen("wamid.A")).toBe(true);
  });

  it("tracks distinct ids independently", () => {
    const store = createIdempotencyStore();
    expect(store.seen("wamid.A")).toBe(false);
    expect(store.seen("wamid.B")).toBe(false);
    expect(store.seen("wamid.A")).toBe(true);
    expect(store.seen("wamid.B")).toBe(true);
  });

  it("evicts oldest ids past maxSize (FIFO)", () => {
    const store = createIdempotencyStore(2);
    expect(store.seen("a")).toBe(false); // [a]
    expect(store.seen("b")).toBe(false); // [a,b]
    expect(store.seen("c")).toBe(false); // [a,b,c] -> evict a -> [b,c]
    expect(store.seen("a")).toBe(false); // a was evicted -> treated as new
    expect(store.seen("c")).toBe(true); // c still tracked
  });
});
