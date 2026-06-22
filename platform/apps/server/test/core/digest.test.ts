import { describe, expect, it, vi } from "vitest";
import {
  buildDigest,
  type DigestDeps,
  msUntilNextRun,
  runDigestOnce,
} from "../../src/core/digest.ts";

describe("buildDigest", () => {
  it("renders the Hebrew summary with counts", () => {
    const msg = buildDigest({ events: 4, handled: 5, errors: 1, pending: 0 });
    expect(msg).toContain("📊 סיכום יומי");
    expect(msg).toContain("אירועים שנוספו: 4");
    expect(msg).toContain("שגיאות: 1");
    expect(msg).not.toContain("ממתינות"); // pending line omitted at 0
  });

  it("includes a pending line only when there are pending messages", () => {
    expect(buildDigest({ events: 0, handled: 0, errors: 0, pending: 2 })).toContain("ממתינות: 2");
  });

  it("sends a heartbeat (all zeros) on a quiet day", () => {
    const msg = buildDigest({ events: 0, handled: 0, errors: 0, pending: 0 });
    expect(msg).toContain("אירועים שנוספו: 0"); // still sent — absence is the down-alert
  });
});

describe("msUntilNextRun (Asia/Jerusalem)", () => {
  // 2026-06-15T10:00:00Z is 13:00 in Jerusalem (IDT, UTC+3) — DST-stable in June.
  const now = new Date("2026-06-15T10:00:00Z");

  it("counts forward to a later hour the same day", () => {
    expect(msUntilNextRun(now, 21)).toBe(8 * 3600 * 1000); // 13:00 → 21:00
  });

  it("wraps to tomorrow when the hour already passed", () => {
    expect(msUntilNextRun(now, 13)).toBe(24 * 3600 * 1000); // exactly now → next day
    expect(msUntilNextRun(now, 12)).toBe(23 * 3600 * 1000); // 1h ago → +23h
  });
});

describe("runDigestOnce", () => {
  it("computes last-24h stats and sends the digest to the admin", async () => {
    const sendText = vi.fn(async (_to: string, _body: string) => {});
    const deps: DigestDeps = {
      events: {
        saveEvent: vi.fn(),
        listEvents: vi.fn(() => []),
        deleteLastFromSender: vi.fn(() => 0),
        countSince: vi.fn(() => 4),
        deleteByProvider: vi.fn(() => 0),
        deleteById: vi.fn(() => 1),
        findEventsByRef: vi.fn(() => []),
        searchEvents: vi.fn(() => []),
        updateEvent: vi.fn(() => null),
        findSlotConflict: vi.fn(() => null),
      },
      inbound: {
        enqueue: vi.fn(() => true),
        markDone: vi.fn(),
        markFailed: vi.fn(),
        pending: vi.fn(() => []),
        listRecent: vi.fn(() => []),
        statsSince: vi.fn(() => ({ done: 5, failed: 1, pending: 0 })),
        countFromSenderSince: vi.fn(() => 0),
      },
      sendText,
      adminPhone: "972501234567",
      hour: 21,
      now: () => new Date("2026-06-15T18:00:00Z"),
    };

    await runDigestOnce(deps);

    expect(deps.events.countSince).toHaveBeenCalledTimes(1);
    expect(deps.inbound.statsSince).toHaveBeenCalledTimes(1);
    const [to, body] = sendText.mock.calls[0]!;
    expect(to).toBe("972501234567");
    expect(body).toContain("אירועים שנוספו: 4");
    expect(body).toContain("הודעות שטופלו: 5");
    expect(body).toContain("שגיאות: 1");
  });
});
