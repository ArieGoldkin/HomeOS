import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { TransientError } from "../../src/core/errors.ts";
import type { HandlerDeps, ProcessDeps } from "../../src/core/handler.ts";
import { handleInbound, processInbound } from "../../src/core/handler.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import type { ToolContext } from "../../src/tools/tools.ts";

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

function makeDeps(
  opts: { parsed?: ParsedEvent[] | null; cancelCount?: number; agentThrows?: unknown } = {},
) {
  const sendText = vi.fn(async (_to: string, _body: string) => {});
  const events = {
    saveEvent: vi.fn(
      (e: ParsedEvent, m: { fromPhone: string; waMessageId: string; seq?: number }) => ({
        id: 7 + (m.seq ?? 0),
        ...e,
      }),
    ),
    listEvents: vi.fn(() => []),
    deleteLastFromSender: vi.fn((_from: string) => opts.cancelCount ?? 1),
    countSince: vi.fn(() => 0),
  };
  // The handler now depends on the agent, not the bare parser; run() keeps the same contract.
  const run = vi.fn(async (_text: string, _ctx: ToolContext): Promise<ParsedEvent[] | null> => {
    if (opts.agentThrows) throw opts.agentThrows;
    return opts.parsed === undefined ? [sampleEvent] : opts.parsed;
  });
  const agent = { run };
  const deps: HandlerDeps = {
    allowlist,
    events,
    agent,
    sendText,
    now: () => new Date("2026-06-20T09:00:00Z"), // → 2026-06-20 in Asia/Jerusalem (IDT)
  };
  return { sendText, events, agent, deps };
}

const textMsg: InboundMessage = {
  id: "wamid.1",
  from: "972501234567",
  type: "text",
  text: "אסיפת הורים מחר ב-18:30",
};

describe("handleInbound (M2)", () => {
  it("parses, persists, and sends a Hebrew confirmation", async () => {
    const { sendText, events, agent, deps } = makeDeps();
    await handleInbound(textMsg, deps);
    // Jerusalem today + server-supplied sender/message id via ToolContext (G8).
    expect(agent.run).toHaveBeenCalledWith("אסיפת הורים מחר ב-18:30", {
      todayIso: "2026-06-20",
      from: "972501234567",
      waMessageId: "wamid.1",
    });
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

  it("on a transient agent error, says 'try again' (not rephrase) and rethrows", async () => {
    const { sendText, events, deps } = makeDeps({ agentThrows: new TransientError("blip") });
    await expect(handleInbound(textMsg, deps)).rejects.toBeInstanceOf(TransientError);
    expect(events.saveEvent).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/תקלה זמנית|נסו שוב/);
    expect(body).not.toMatch(/לנסח/); // never the "rephrase" message for an API blip
  });

  it("undoes the last message on ביטול (deletes + confirms, never parses)", async () => {
    const { sendText, events, agent, deps } = makeDeps({ cancelCount: 2 });
    await handleInbound({ ...textMsg, text: "ביטול" }, deps);
    expect(agent.run).not.toHaveBeenCalled();
    expect(events.deleteLastFromSender).toHaveBeenCalledWith("972501234567");
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/בוטל/);
    expect(body).toContain("2"); // count of removed items
  });

  it("replies 'nothing to cancel' when ביטול finds no events", async () => {
    const { sendText, events, deps } = makeDeps({ cancelCount: 0 });
    await handleInbound({ ...textMsg, text: "ביטול" }, deps);
    expect(events.saveEvent).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/אין מה לבטל/);
  });

  it("refuses a non-allowlisted sender before running the agent", async () => {
    const { sendText, agent, deps } = makeDeps();
    await handleInbound({ ...textMsg, from: "972509999999" }, deps);
    expect(agent.run).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/הרשאה|מצטער/);
  });

  it("rephrases an over-length message BEFORE running the agent (input cap, G2)", async () => {
    const { sendText, agent, events, deps } = makeDeps();
    // A 50–100KB forward (long newsletter / pasted PDF) must never reach Claude ~2×/message.
    const huge = "א".repeat(5000);
    await handleInbound({ ...textMsg, text: huge }, deps);
    expect(agent.run).not.toHaveBeenCalled();
    expect(events.saveEvent).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/לנסח|להבין/);
  });

  it("replies text-only for a non-text message (voice deferred to M2b)", async () => {
    const { sendText, agent, deps } = makeDeps();
    await handleInbound({ id: "wamid.2", from: "972501234567", type: "image" }, deps);
    expect(agent.run).not.toHaveBeenCalled();
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
      statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
    };
  }

  it("marks the row done after a successful handle", async () => {
    const { deps } = makeDeps();
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps);
    expect(inbound.markDone).toHaveBeenCalledWith("wamid.1");
    expect(inbound.markFailed).not.toHaveBeenCalled();
  });

  it("marks the row failed (not done) when handling throws a non-transient error", async () => {
    const { deps, sendText } = makeDeps();
    sendText.mockRejectedValueOnce(new Error("boom")); // a plain (permanent) failure
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps); // never throws
    expect(inbound.markFailed).toHaveBeenCalledWith("wamid.1");
    expect(inbound.markDone).not.toHaveBeenCalled();
  });

  it("leaves the row pending on a transient error (replayable, not failed)", async () => {
    const { deps } = makeDeps({ agentThrows: new TransientError("blip") });
    const inbound = makeInbound();
    await processInbound(textMsg, { ...deps, inbound } as ProcessDeps); // never throws
    expect(inbound.markDone).not.toHaveBeenCalled();
    expect(inbound.markFailed).not.toHaveBeenCalled(); // stays pending → boot-replay retries
  });
});
