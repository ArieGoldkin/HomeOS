import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import type { HandlerDeps, ProcessDeps } from "../../src/core/handler.ts";
import { handleInbound, processInbound } from "../../src/core/handler.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";

const allowlist = ["972501234567"];

const sampleEvent: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: null,
  recurrence: null,
  source_text: "אסיפת הורים מחר ב-18:30",
};

function makeDeps(opts: { parsed?: ParsedEvent[] | null } = {}) {
  const sendText = vi.fn(async (_to: string, _body: string) => {});
  const events = {
    saveEvent: vi.fn(
      (e: ParsedEvent, m: { fromPhone: string; waMessageId: string; seq?: number }) => ({
        id: 7 + (m.seq ?? 0),
        ...e,
      }),
    ),
    listEvents: vi.fn(() => []),
  };
  const parse = vi.fn(
    async (_text: string, _today: string): Promise<ParsedEvent[] | null> =>
      opts.parsed === undefined ? [sampleEvent] : opts.parsed,
  );
  const deps: HandlerDeps = {
    allowlist,
    events,
    parse,
    sendText,
    now: () => new Date("2026-06-20T09:00:00Z"), // → 2026-06-20 in Asia/Jerusalem (IDT)
  };
  return { sendText, events, parse, deps };
}

const textMsg: InboundMessage = {
  id: "wamid.1",
  from: "972501234567",
  type: "text",
  text: "אסיפת הורים מחר ב-18:30",
};

describe("handleInbound (M2)", () => {
  it("parses, persists, and sends a Hebrew confirmation", async () => {
    const { sendText, events, parse, deps } = makeDeps();
    await handleInbound(textMsg, deps);
    expect(parse).toHaveBeenCalledWith("אסיפת הורים מחר ב-18:30", "2026-06-20"); // Jerusalem today
    expect(events.saveEvent).toHaveBeenCalledTimes(1);
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toContain("הוספתי ליומן");
    expect(body).toContain("אסיפת הורים");
    // F: friendly Hebrew date (he-IL, Asia/Jerusalem), not robotic ISO.
    expect(body).toContain("ביוני"); // 2026-06-21 → "21 ביוני"
    expect(body).toContain("18:30"); // time appended verbatim
    expect(body).not.toContain("2026-06-21"); // ISO no longer surfaced
  });

  it("saves every event from a multi-event message and confirms the count", async () => {
    const second: ParsedEvent = { ...sampleEvent, title_he: "טיול שנתי", time: null };
    const { sendText, events, deps } = makeDeps({ parsed: [sampleEvent, second] });
    await handleInbound(textMsg, deps);
    expect(events.saveEvent).toHaveBeenCalledTimes(2);
    expect(events.saveEvent.mock.calls[0]![1]).toMatchObject({ seq: 0 });
    expect(events.saveEvent.mock.calls[1]![1]).toMatchObject({ seq: 1 });
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toContain("2"); // count in the summary
    expect(body).toContain("אסיפת הורים");
    expect(body).toContain("טיול שנתי");
  });

  it("asks to rephrase when parsing fails, without persisting", async () => {
    const { sendText, events, deps } = makeDeps({ parsed: null });
    await handleInbound(textMsg, deps);
    expect(events.saveEvent).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/לנסח|להבין/);
  });

  it("asks to rephrase on an empty events list (parsed, but nothing schedulable)", async () => {
    const { sendText, events, deps } = makeDeps({ parsed: [] });
    await handleInbound(textMsg, deps);
    expect(events.saveEvent).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/לנסח|להבין/);
  });

  it("refuses a non-allowlisted sender before parsing", async () => {
    const { sendText, parse, deps } = makeDeps();
    await handleInbound({ ...textMsg, from: "972509999999" }, deps);
    expect(parse).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/הרשאה|מצטער/);
  });

  it("replies text-only for a non-text message (voice deferred to M2b)", async () => {
    const { sendText, parse, deps } = makeDeps();
    await handleInbound({ id: "wamid.2", from: "972501234567", type: "image" }, deps);
    expect(parse).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/טקסט/);
  });
});

describe("processInbound (queue settle)", () => {
  function makeInbound() {
    return {
      enqueue: vi.fn(() => true),
      markDone: vi.fn(),
      markFailed: vi.fn(),
      pending: vi.fn(() => []),
    };
  }

  it("marks the row done after a successful handle", async () => {
    const { deps } = makeDeps();
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps);
    expect(inbound.markDone).toHaveBeenCalledWith("wamid.1");
    expect(inbound.markFailed).not.toHaveBeenCalled();
  });

  it("marks the row failed (not done) when handling throws", async () => {
    const { deps, sendText } = makeDeps();
    sendText.mockRejectedValueOnce(new Error("Graph 503")); // transient send failure
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps); // never throws
    expect(inbound.markFailed).toHaveBeenCalledWith("wamid.1");
    expect(inbound.markDone).not.toHaveBeenCalled();
  });
});
