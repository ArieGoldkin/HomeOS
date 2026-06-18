import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { TransientError } from "../../src/core/errors.ts";
import type { HandlerDeps, ProcessDeps } from "../../src/core/handler.ts";
import { handleInbound, processInbound } from "../../src/core/handler.ts";
import type { SavedEvent } from "../../src/db/event-store.ts";
import type { InboundStore } from "../../src/db/inbound-store.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import type { GmailToolDeps, ToolContext } from "../../src/tools/tools.ts";

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
// #71: the agent now returns the rows a tool already PERSISTED (SavedEvent), not raw ParsedEvent.
const sampleSaved: SavedEvent = { id: 7, source_provider: null, ...sampleEvent };

function makeDeps(
  opts: {
    saved?: SavedEvent[] | null;
    cancelCount?: number;
    agentThrows?: unknown;
    members?: Record<string, string>;
    /** G16: when set, wires the ceiling + an inbound counter stub returning `senderCount`. */
    maxPerSenderPerDay?: number;
    senderCount?: number;
    /** #72: when defined, wires deps.google with a credential present (true) or absent (false). */
    google?: boolean;
    /** #72: what the agent's read_gmail run returns on the sync path (default [sampleSaved]). */
    syncSaved?: SavedEvent[] | null;
  } = {},
) {
  const sendText = vi.fn(async (_to: string, _body: string) => {});
  // The store stub stays for the ביטול undo path; #71 means the HANDLER no longer calls saveEvent.
  const events = {
    saveEvent: vi.fn(
      (
        e: ParsedEvent,
        m: { fromPhone: string; waMessageId: string; seq?: number },
      ): SavedEvent => ({
        id: 7 + (m.seq ?? 0),
        source_provider: null,
        ...e,
      }),
    ),
    listEvents: vi.fn(() => []),
    deleteLastFromSender: vi.fn((_from: string) => opts.cancelCount ?? 1),
    countSince: vi.fn(() => 0),
    deleteByProvider: vi.fn(() => 0),
  };
  // The handler depends on the agent; run() now returns the persisted SavedEvent[] (or null). The
  // sync path is distinguished by opts.forceTool === "read_gmail" (3rd arg), so the mock can branch.
  const run = vi.fn(
    async (
      _text: string,
      _ctx: ToolContext,
      runOpts?: { forceTool?: string },
    ): Promise<SavedEvent[] | null> => {
      if (opts.agentThrows) throw opts.agentThrows;
      if (runOpts?.forceTool === "read_gmail") {
        return opts.syncSaved === undefined ? [sampleSaved] : opts.syncSaved;
      }
      return opts.saved === undefined ? [sampleSaved] : opts.saved;
    },
  );
  const agent = { run };
  // #72: a fake Gmail seam. `google: true` → a stored credential; `google: false` → none (not connected).
  const google: GmailToolDeps | undefined =
    opts.google === undefined
      ? undefined
      : ({
          client: { list: vi.fn(), get: vi.fn() },
          oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
          credentials: {
            get: vi.fn(() =>
              opts.google
                ? { accessToken: "a", refreshToken: "r", expiry: "2099-01-01 00:00:00", scopes: [] }
                : null,
            ),
            updateTokens: vi.fn(),
            delete: vi.fn(),
          },
          maxMessages: 10,
          queryWindow: "newer_than:7d",
          allowedLabels: [],
        } as unknown as GmailToolDeps);
  // G16 counter stub — only attached when the ceiling is configured, so the rate gate stays off
  // for every other test (the production path always wires both via index.ts).
  const countFromSenderSince = vi.fn((_from: string, _since: string) => opts.senderCount ?? 0);
  const deps: HandlerDeps = {
    allowlist,
    events,
    agent,
    sendText,
    members: opts.members,
    google,
    now: () => new Date("2026-06-20T09:00:00Z"), // → 2026-06-20 in Asia/Jerusalem (IDT)
    ...(opts.maxPerSenderPerDay !== undefined
      ? {
          maxPerSenderPerDay: opts.maxPerSenderPerDay,
          inbound: { countFromSenderSince } as unknown as InboundStore,
        }
      : {}),
  };
  return { sendText, events, agent, deps, countFromSenderSince };
}

const textMsg: InboundMessage = {
  id: "wamid.1",
  from: "972501234567",
  type: "text",
  text: "אסיפת הורים מחר ב-18:30",
};

describe("handleInbound (M2)", () => {
  it("runs the agent and sends a Hebrew confirmation (the tool persists, not the handler)", async () => {
    const { sendText, events, agent, deps } = makeDeps();
    await handleInbound(textMsg, deps);
    // Jerusalem today + server-supplied sender/messageId/familyId + the events store via ToolContext (G8/#71).
    expect(agent.run).toHaveBeenCalledWith("אסיפת הורים מחר ב-18:30", {
      todayIso: "2026-06-20",
      from: "972501234567",
      waMessageId: "wamid.1",
      familyId: "default",
      events,
    });
    expect(events.saveEvent).not.toHaveBeenCalled(); // #71: persistence moved into the tool
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toContain("הוספתי ליומן");
    expect(body).toContain("אסיפת הורים");
    // F: friendly Hebrew date (he-IL, Asia/Jerusalem), not robotic ISO.
    expect(body).toContain("ביוני"); // 2026-06-21 → "21 ביוני"
    expect(body).toContain("18:30"); // time appended verbatim
    expect(body).not.toContain("2026-06-21"); // ISO no longer surfaced
  });

  it("resolves the sender's family-member name into ToolContext (members map, #14)", async () => {
    const { agent, deps, events } = makeDeps({ members: { "972501234567": "אבא" } });
    await handleInbound(textMsg, deps);
    expect(agent.run).toHaveBeenCalledWith("אסיפת הורים מחר ב-18:30", {
      todayIso: "2026-06-20",
      from: "972501234567",
      waMessageId: "wamid.1",
      senderName: "אבא",
      familyId: "default",
      events,
    });
  });

  it("confirms every event of a multi-event agent result with a count", async () => {
    const second: SavedEvent = { ...sampleSaved, id: 8, title_he: "טיול שנתי", time: null };
    const { sendText, events, deps } = makeDeps({ saved: [sampleSaved, second] });
    await handleInbound(textMsg, deps);
    expect(events.saveEvent).not.toHaveBeenCalled(); // the tool already persisted both
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toContain("2"); // count in the summary
    expect(body).toContain("אסיפת הורים");
    expect(body).toContain("טיול שנתי");
  });

  it("asks to rephrase when the agent returns null, without persisting", async () => {
    const { sendText, events, deps } = makeDeps({ saved: null });
    await handleInbound(textMsg, deps);
    expect(events.saveEvent).not.toHaveBeenCalled();
    const [, body] = sendText.mock.calls[0]!;
    expect(body).toMatch(/לנסח|להבין/);
  });

  it("asks to rephrase on an empty events list (ran, but nothing schedulable)", async () => {
    const { sendText, events, deps } = makeDeps({ saved: [] });
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

  it("undoes the last message on ביטול (deletes + confirms, never runs the agent)", async () => {
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

  describe("Gmail sync — 'סנכרן מייל' (#72)", () => {
    const syncMsg: InboundMessage = { ...textMsg, text: "סנכרן מייל" };

    it("when connected: runs the agent forcing read_gmail with ctx.google, then confirms", async () => {
      const { sendText, agent, deps } = makeDeps({ google: true });
      await handleInbound(syncMsg, deps);
      expect(agent.run).toHaveBeenCalledTimes(1);
      const call = agent.run.mock.calls[0]!;
      expect(call[2]).toEqual({ forceTool: "read_gmail" }); // turn-0 forced tool (G4 preserved)
      expect(call[1]).toMatchObject({ familyId: "default", google: deps.google }); // the G8 gate is set
      expect(sendText.mock.calls[0]![1]).toContain("הוספתי"); // confirm
    });

    it("replies 'connect first' when Google isn't configured — ZERO agent calls", async () => {
      const { sendText, agent, deps } = makeDeps(); // no google
      await handleInbound(syncMsg, deps);
      expect(agent.run).not.toHaveBeenCalled();
      expect(sendText.mock.calls[0]![1]).toMatch(/לא מחובר|לחבר/);
    });

    it("replies 'connect first' when configured but no credential is stored — ZERO agent calls", async () => {
      const { sendText, agent, deps } = makeDeps({ google: false });
      await handleInbound(syncMsg, deps);
      expect(agent.run).not.toHaveBeenCalled();
      expect(sendText.mock.calls[0]![1]).toMatch(/לא מחובר|לחבר/);
    });

    it("replies 'no new items' when the sync finds nothing", async () => {
      const { sendText, deps } = makeDeps({ google: true, syncSaved: [] });
      await handleInbound(syncMsg, deps);
      expect(sendText.mock.calls[0]![1]).toMatch(/לא נמצאו|📭/);
    });

    it("on a transient Gmail error, says 'try again' and rethrows (row stays pending)", async () => {
      const { sendText, deps } = makeDeps({
        google: true,
        agentThrows: new TransientError("blip"),
      });
      await expect(handleInbound(syncMsg, deps)).rejects.toBeInstanceOf(TransientError);
      expect(sendText.mock.calls[0]![1]).toMatch(/תקלה זמנית|נסו שוב/);
    });

    it("on a PERMANENT Gmail error (4xx), replies a failure (not silence) and rethrows (row markFails)", async () => {
      const { sendText, deps } = makeDeps({ google: true, agentThrows: new Error("gmail 403") });
      await expect(handleInbound(syncMsg, deps)).rejects.toThrow("gmail 403");
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText.mock.calls[0]![1]).toMatch(/נכשל|מאוחר/); // acknowledged, not silent
    });
  });

  describe("per-sender daily ceiling (G16)", () => {
    it("caps a sender over the ceiling — quiet reply, no model call, nothing persisted", async () => {
      const { sendText, agent, events, deps, countFromSenderSince } = makeDeps({
        maxPerSenderPerDay: 50,
        senderCount: 51, // the current message is already enqueued → this is the 51st today
      });
      await handleInbound(textMsg, deps);
      expect(agent.run).not.toHaveBeenCalled();
      expect(events.saveEvent).not.toHaveBeenCalled();
      expect(countFromSenderSince).toHaveBeenCalledWith("972501234567", expect.any(String));
      const [, body] = sendText.mock.calls[0]!;
      expect(body).toMatch(/מכסת|מחר/);
    });

    it("lets a sender at exactly the ceiling through (boundary: count === max)", async () => {
      const { agent, deps } = makeDeps({ maxPerSenderPerDay: 50, senderCount: 50 });
      await handleInbound(textMsg, deps);
      expect(agent.run).toHaveBeenCalledTimes(1);
    });

    it("does not enforce a ceiling when unconfigured (off by default)", async () => {
      const { agent, deps } = makeDeps({ senderCount: 9999 }); // no ceiling wired → no inbound counter
      await handleInbound(textMsg, deps);
      expect(agent.run).toHaveBeenCalledTimes(1);
    });

    it("counts only AFTER the allowlist gate — a non-family sender is never counted", async () => {
      const { agent, deps, countFromSenderSince } = makeDeps({
        maxPerSenderPerDay: 1,
        senderCount: 999,
      });
      await handleInbound({ ...textMsg, from: "972509999999" }, deps);
      expect(countFromSenderSince).not.toHaveBeenCalled(); // refused before the rate check
      expect(agent.run).not.toHaveBeenCalled();
    });
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
      countFromSenderSince: vi.fn(() => 0),
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
