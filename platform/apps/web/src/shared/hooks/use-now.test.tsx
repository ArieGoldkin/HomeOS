import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the current time on mount", () => {
    vi.setSystemTime(new Date("2026-06-20T12:00:00Z"));
    const { result } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });

  it("advances every minute", () => {
    vi.setSystemTime(new Date("2026-06-20T12:00:00Z"));
    const { result } = renderHook(() => useNow());
    // advanceTimersByTime moves the faked Date too, so the interval's `new Date()` reads 12:01.
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.toISOString()).toBe("2026-06-20T12:01:00.000Z");
  });
});
