import { describe, expect, it, vi } from "vitest";
import { createRateLimiter, mismatchDelay } from "../../src/http/rate-limit.ts";

// #107 — a minimal per-IP FIXED-WINDOW counter (NOT a throttling subsystem). The clock is injected so
// the window roll-over is deterministic; the mismatch delay is injectable/0 so tests never sleep.

describe("createRateLimiter — per-IP fixed window (#107)", () => {
  it("permits up to `max` attempts in the window, then reports limited (429 semantics)", () => {
    let nowMs = 1_000_000;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: () => nowMs });
    expect(limiter.check("1.1.1.1").limited).toBe(false); // 1
    expect(limiter.check("1.1.1.1").limited).toBe(false); // 2
    expect(limiter.check("1.1.1.1").limited).toBe(false); // 3 — the ceiling, still allowed
    expect(limiter.check("1.1.1.1").limited).toBe(true); // 4 — over the ceiling
  });

  it("resets once the fixed window rolls over (fake clock)", () => {
    let nowMs = 1_000_000;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: () => nowMs });
    expect(limiter.check("2.2.2.2").limited).toBe(false);
    expect(limiter.check("2.2.2.2").limited).toBe(false);
    expect(limiter.check("2.2.2.2").limited).toBe(true); // tripped in window 1
    nowMs += 60_000; // advance past the window
    expect(limiter.check("2.2.2.2").limited).toBe(false); // fresh window — counter reset
  });

  it("counts each IP independently", () => {
    let nowMs = 1_000_000;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => nowMs });
    expect(limiter.check("3.3.3.3").limited).toBe(false);
    expect(limiter.check("3.3.3.3").limited).toBe(true); // 3.3.3.3 over the ceiling
    expect(limiter.check("4.4.4.4").limited).toBe(false); // a different IP is unaffected
  });
});

describe("mismatchDelay — fixed wrong-bearer delay (#107)", () => {
  it("awaits the injected delay (0 in tests — no real sleep)", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    await mismatchDelay(250, sleep);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("is a no-op when the configured delay is 0", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    await mismatchDelay(0, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });
});
