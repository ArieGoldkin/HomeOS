import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleEvery } from "../../src/core/scheduler.ts";

describe("scheduleEvery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the task every interval (first fire after one interval)", async () => {
    const task = vi.fn(async () => {});
    scheduleEvery(1000, task);

    expect(task).not.toHaveBeenCalled(); // nothing before the first interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("stop() cancels future runs", async () => {
    const task = vi.fn(async () => {});
    const { stop } = scheduleEvery(1000, task);
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("routes a task rejection to onError and keeps the loop running", async () => {
    const onError = vi.fn();
    const task = vi.fn(async () => {
      throw new Error("boom");
    });
    scheduleEvery(1000, task, { onError });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2); // survived the first rejection
  });
});
