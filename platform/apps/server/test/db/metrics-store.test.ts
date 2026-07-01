import { describe, expect, it } from "vitest";
import { createMetricsStore } from "../../src/db/metrics-store.ts";

describe("MetricsStore — board-read tally (#26)", () => {
  it("counts DISTINCT days with a read, not the raw read count", () => {
    const store = createMetricsStore(":memory:");
    store.recordBoardRead();
    store.recordBoardRead();
    store.recordBoardRead(); // 3 reads, all today → still ONE distinct day
    expect(store.boardReadDaysSince("2000-01-01")).toBe(1);
  });

  it("is empty before any read, and the since-filter excludes future dates", () => {
    const store = createMetricsStore(":memory:");
    expect(store.boardReadDaysSince("2000-01-01")).toBe(0);
    store.recordBoardRead();
    expect(store.boardReadDaysSince("2000-01-01")).toBe(1);
    expect(store.boardReadDaysSince("2999-01-01")).toBe(0); // today's read is before the future `since`
  });

  it("accepts a datetime `since` (normalized to its calendar day)", () => {
    const store = createMetricsStore(":memory:");
    store.recordBoardRead();
    expect(store.boardReadDaysSince("2000-01-01 12:34:56")).toBe(1);
  });
});
