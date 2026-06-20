import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgentResult } from "../../src/core/agent.ts";
import { TransientError } from "../../src/core/errors.ts";
import type { HandlerDeps, ProcessDeps } from "../../src/core/handler.ts";
import { handleInbound, processInbound } from "../../src/core/handler.ts";
import {
  type ConversationPayload,
  type ConversationStore,
  createConversationStore,
} from "../../src/db/conversation-store.ts";
import type { SavedEvent } from "../../src/db/event-store.ts";
import type { InboundStore } from "../../src/db/inbound-store.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import type {
  CalendarToolDeps,
  ClarifyResult,
  GmailToolDeps,
  ToolContext,
} from "../../src/tools/tools.ts";

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
    /** #18: when defined, wires deps.calendar with a credential present (true) or absent (false). */
    calendar?: boolean;
    /** #18: what the agent's read_calendar run returns on the sync path (default [sampleSaved]). */
    calSyncSaved?: SavedEvent[] | null;
    /** #18 chunk 2: enable auto-push of forwarded events to Google Calendar. */
    autoPush?: boolean;
    /** #83: wire an open-thread store so the RESUME branch engages (omitted ⇒ branch inert). */
    conversations?: ConversationStore;
    /** #84: when set, agent.run (the main path) returns this clarify arm instead of saved rows. */
    clarifyResult?: ClarifyResult;
    /** #84: when defined, wires deps.parse (the clarify-resume re-parse seam) to return this. */
    parseReturns?: ParsedEvent[] | null;
    /** #84/F2: when set, deps.parse throws this (e.g. a TransientError) — proves the thread survives. */
    parseThrows?: unknown;
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
    deleteById: vi.fn(() => 1),
    findEventsByRef: vi.fn((): SavedEvent[] => []),
  };
  // The handler depends on the agent; run() returns persisted SavedEvent[], a {clarify} arm (#84), or
  // null. The sync path is distinguished by opts.forceTool === "read_gmail" (3rd arg), so it can branch.
  const run = vi.fn(
    async (
      _text: string,
      _ctx: ToolContext,
      runOpts?: { forceTool?: string },
    ): Promise<AgentResult> => {
      if (opts.agentThrows) throw opts.agentThrows;
      if (runOpts?.forceTool === "read_gmail") {
        return opts.syncSaved === undefined ? [sampleSaved] : opts.syncSaved;
      }
      if (runOpts?.forceTool === "read_calendar") {
        return opts.calSyncSaved === undefined ? [sampleSaved] : opts.calSyncSaved;
      }
      // #84: the main forward path returns a clarify arm when the parse flagged a required slot.
      if (opts.clarifyResult) return { clarify: opts.clarifyResult };
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
  // #18: a fake Calendar seam. `calendar: true` → a stored credential; `false` → none (not connected).
  const calendar: CalendarToolDeps | undefined =
    opts.calendar === undefined
      ? undefined
      : ({
          client: {
            list: vi.fn(),
            findEventIdByPrivateProp: vi.fn(async () => null),
            insertEvent: vi.fn(async () => ({ id: "gcal-new" })),
            patchEvent: vi.fn(async () => ({ id: "gcal-p" })),
          },
          oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
          credentials: {
            get: vi.fn(() =>
              opts.calendar
                ? { accessToken: "a", refreshToken: "r", expiry: "2099-01-01 00:00:00", scopes: [] }
                : null,
            ),
            updateTokens: vi.fn(),
            delete: vi.fn(),
          },
          calendarId: "primary",
          windowDays: 30,
          maxEvents: 20,
        } as unknown as CalendarToolDeps);
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
    calendar,
    autoPushCalendar: opts.autoPush,
    ...(opts.conversations ? { conversations: opts.conversations } : {}),
    ...(opts.parseThrows !== undefined
      ? {
          parse: vi.fn(async () => {
            throw opts.parseThrows;
          }),
        }
      : opts.parseReturns !== undefined
        ? { parse: vi.fn(async () => opts.parseReturns ?? null) }
        : {}),
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

  describe("Calendar sync — 'סנכרן יומן' (#18)", () => {
    const syncMsg: InboundMessage = { ...textMsg, text: "סנכרן יומן" };

    it("when connected: runs the agent forcing read_calendar with ctx.calendar, then confirms", async () => {
      const { sendText, agent, deps } = makeDeps({ calendar: true });
      await handleInbound(syncMsg, deps);
      expect(agent.run).toHaveBeenCalledTimes(1);
      const call = agent.run.mock.calls[0]!;
      expect(call[2]).toEqual({ forceTool: "read_calendar" }); // turn-0 forced tool (G4 preserved)
      expect(call[1]).toMatchObject({ familyId: "default", calendar: deps.calendar }); // the G8 gate
      expect(sendText.mock.calls[0]![1]).toContain("הוספתי"); // confirm
    });

    it("replies 'connect first' when Calendar isn't configured — ZERO agent calls", async () => {
      const { sendText, agent, deps } = makeDeps(); // no calendar
      await handleInbound(syncMsg, deps);
      expect(agent.run).not.toHaveBeenCalled();
      expect(sendText.mock.calls[0]![1]).toMatch(/לא מחובר|לחבר/);
    });

    it("replies 'connect first' when configured but no credential is stored — ZERO agent calls", async () => {
      const { sendText, agent, deps } = makeDeps({ calendar: false });
      await handleInbound(syncMsg, deps);
      expect(agent.run).not.toHaveBeenCalled();
      expect(sendText.mock.calls[0]![1]).toMatch(/לא מחובר|לחבר/);
    });

    it("replies 'no new items' when the sync finds nothing", async () => {
      const { sendText, deps } = makeDeps({ calendar: true, calSyncSaved: [] });
      await handleInbound(syncMsg, deps);
      expect(sendText.mock.calls[0]![1]).toMatch(/לא נמצאו|📭/);
    });

    it("on a transient Calendar error, says 'try again' and rethrows (row stays pending)", async () => {
      const { sendText, deps } = makeDeps({
        calendar: true,
        agentThrows: new TransientError("blip"),
      });
      await expect(handleInbound(syncMsg, deps)).rejects.toBeInstanceOf(TransientError);
      expect(sendText.mock.calls[0]![1]).toMatch(/תקלה זמנית|נסו שוב/);
    });

    it("a forward still routes to extract_events, not the calendar sync", async () => {
      const { agent, deps } = makeDeps({ calendar: true });
      await handleInbound(textMsg, deps);
      expect(agent.run.mock.calls[0]![2]).toBeUndefined(); // default tool, not forced read_calendar
    });
  });

  describe("Calendar auto-push on a forward (#18 chunk 2)", () => {
    it("pushes the new board events to Google Calendar when connected + enabled", async () => {
      const { sendText, deps } = makeDeps({ calendar: true, autoPush: true });
      await handleInbound(textMsg, deps);
      expect(sendText.mock.calls[0]![1]).toContain("הוספתי"); // confirm still sent first
      expect(deps.calendar!.client.insertEvent).toHaveBeenCalledTimes(1);
    });

    it("does NOT push when auto-push is disabled (read-only calendar)", async () => {
      const { deps } = makeDeps({ calendar: true, autoPush: false });
      await handleInbound(textMsg, deps);
      expect(deps.calendar!.client.insertEvent).not.toHaveBeenCalled();
    });

    it("does NOT push for an app-only family (no calendar deps), still confirms", async () => {
      const { sendText, deps } = makeDeps({ autoPush: true }); // no calendar wired
      await handleInbound(textMsg, deps);
      expect(deps.calendar).toBeUndefined();
      expect(sendText.mock.calls[0]![1]).toContain("הוספתי");
    });

    it("a push failure never breaks the confirm (best-effort, after the confirm)", async () => {
      const { sendText, deps } = makeDeps({ calendar: true, autoPush: true });
      vi.mocked(deps.calendar!.client.insertEvent).mockRejectedValueOnce(
        new TransientError("blip"),
      );
      await expect(handleInbound(textMsg, deps)).resolves.toBeUndefined();
      expect(sendText.mock.calls[0]![1]).toContain("הוספתי");
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

// #83 (Milestone #8): the RESUME branch — an open conversation thread routes the sender's next
// message to the deterministic resume (echo stub here), never back through agent.run (G17). The
// store is the REAL in-memory ConversationStore; makeDeps pins now → 2026-06-20 09:00:00 (sqliteUtc).
describe("handleInbound — #83 RESUME branch", () => {
  const NOW_SQLITE = "2026-06-20 09:00:00";
  const FUTURE = "2026-06-20 12:00:00"; // expiresAt after NOW → thread is open
  const PAST = "2026-06-20 08:00:00"; // expiresAt before NOW → thread is expired
  const clarifyPayload: ConversationPayload = {
    kind: "clarify",
    reason: "ambiguous_title", // the answer becomes the title — no re-parse seam needed for routing
    draft: sampleEvent,
  };
  function seed(store: ConversationStore, expiresAt: string) {
    store.create({ fromPhone: textMsg.from, payload: clarifyPayload, expiresAt });
  }

  it("routes an answer to the resume (completes the draft + saves) and NEVER calls agent.run (G17)", async () => {
    const conversations = createConversationStore(":memory:");
    seed(conversations, FUTURE);
    const { deps, sendText, agent, events } = makeDeps({ conversations });

    await handleInbound(textMsg, deps);

    expect(agent.run).not.toHaveBeenCalled(); // the answer never enters the auto agent loop
    expect(events.saveEvent).toHaveBeenCalledTimes(1); // ambiguous_title → answer becomes title, saved
    expect(sendText.mock.calls[0]?.[1]).toContain("הוספתי"); // a confirm, not model prose
    expect(conversations.getPending(textMsg.from, NOW_SQLITE)).toBeNull(); // resolved (single-use)
  });

  it("a redelivered answer (thread already resolved) falls through to the normal parse", async () => {
    const conversations = createConversationStore(":memory:"); // no pending row
    const { deps, agent } = makeDeps({ conversations });

    await handleInbound(textMsg, deps);

    expect(agent.run).toHaveBeenCalledTimes(1); // no open thread → normal agent.run path
  });

  it("an expired thread is swept (expireStale) and the message is treated as fresh", async () => {
    const conversations = createConversationStore(":memory:");
    seed(conversations, PAST); // already expired at NOW
    const { deps, agent } = makeDeps({ conversations });

    await handleInbound(textMsg, deps);

    expect(agent.run).toHaveBeenCalledTimes(1); // expired → not resumed
    expect(conversations.getPending(textMsg.from, PAST)).toBeNull(); // swept outright, not just hidden
  });

  it("is INERT when no conversations store is wired (additive, backward-compatible)", async () => {
    const { deps, agent } = makeDeps(); // conversations unset
    await handleInbound(textMsg, deps);
    expect(agent.run).toHaveBeenCalledTimes(1);
  });

  it("processInbound marks the resumed inbound DONE (the conversation row holds open state)", async () => {
    const conversations = createConversationStore(":memory:");
    seed(conversations, FUTURE);
    const { deps, agent } = makeDeps({ conversations });
    const inbound = {
      enqueue: vi.fn(() => true),
      markDone: vi.fn(),
      markFailed: vi.fn(),
      pending: vi.fn(() => []),
      statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
      countFromSenderSince: vi.fn(() => 0),
    };

    await processInbound(textMsg, { ...deps, inbound } as unknown as ProcessDeps);

    expect(inbound.markDone).toHaveBeenCalledWith("wamid.1");
    expect(agent.run).not.toHaveBeenCalled();
  });
});

// #84 (Milestone #8): the confidence gate. A clarify arm from agent.run opens a templated thread and
// saves nothing — the user only ever sees a SERVER template, never model prose (red line).
describe("handleInbound — #84 clarify gate", () => {
  const clarifyDraft: ParsedEvent = {
    ...sampleEvent,
    needs_clarification: { reason: "missing_date" },
  };
  const clarifyResult: ClarifyResult = { draft: clarifyDraft, reason: "missing_date" };

  it("opens a clarify thread, sends the server template, and never confirms/saves", async () => {
    const conversations = createConversationStore(":memory:");
    const { deps, sendText } = makeDeps({ conversations, clarifyResult });

    await handleInbound(textMsg, deps);

    // exactly ONE message — the templated Hebrew question (no confirm follows, no model prose)
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[1]).toContain("תאריך"); // the missing_date template asks for the date
    // a clarify thread now holds the draft for this sender (NOW_SQLITE from makeDeps' pinned clock)
    const pending = conversations.getPending(textMsg.from, "2026-06-20 09:00:00");
    expect(pending?.kind).toBe("clarify");
    expect(JSON.parse(pending?.payload_json ?? "{}").draft.title_he).toBe(sampleEvent.title_he);
  });

  it("degrades to REPHRASE when no conversations store is wired (no thread to open)", async () => {
    const { deps, sendText } = makeDeps({ clarifyResult }); // conversations unset
    await handleInbound(textMsg, deps);
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("לנסח"));
  });
});

// #84 — the clarify RESUME merge: complete the held draft from the answer, re-validate, save + confirm.
describe("handleInbound — #84 clarify resume (merge)", () => {
  const NOW = "2026-06-20 09:00:00";
  const dateDraft: ParsedEvent = {
    ...sampleEvent,
    date_iso: "2026-06-20", // a placeholder the model guessed; the answer overwrites it
    needs_clarification: { reason: "missing_date" },
  };
  function seedDateThread(store: ConversationStore) {
    store.create({
      fromPhone: textMsg.from,
      payload: { kind: "clarify", reason: "missing_date", draft: dateDraft },
      expiresAt: "2026-06-20 12:00:00",
    });
  }

  it("missing_date: re-parses the answer, merges the date into the draft, saves + confirms", async () => {
    const conversations = createConversationStore(":memory:");
    seedDateThread(conversations);
    const dated: ParsedEvent = { ...sampleEvent, date_iso: "2026-06-21", time: "20:00" };
    const { deps, sendText, events, agent } = makeDeps({ conversations, parseReturns: [dated] });

    await handleInbound({ ...textMsg, text: "ביום ראשון בשמונה בערב" }, deps);

    expect(agent.run).not.toHaveBeenCalled(); // re-parse via the parse seam, never the auto agent loop
    expect(events.saveEvent).toHaveBeenCalledTimes(1);
    const savedArg = events.saveEvent.mock.calls[0]?.[0];
    expect(savedArg?.date_iso).toBe("2026-06-21"); // the re-parsed date merged in
    expect(savedArg?.time).toBe("20:00");
    expect(savedArg?.title_he).toBe(sampleEvent.title_he); // the draft's title is preserved
    expect(sendText.mock.calls[0]?.[1]).toContain("הוספתי"); // a confirm
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // single-use
  });

  it("missing_date: an unparseable answer abandons the draft with REPHRASE (nothing saved, turn cap 1)", async () => {
    const conversations = createConversationStore(":memory:");
    seedDateThread(conversations);
    const { deps, sendText, events } = makeDeps({ conversations, parseReturns: null });

    await handleInbound({ ...textMsg, text: "מתישהו" }, deps);

    expect(events.saveEvent).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("לנסח"));
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // resolved → a 2nd answer is fresh
  });

  it("F1: an oversized answer is capped (G2) BEFORE the resume re-parse — thread left open", async () => {
    const conversations = createConversationStore(":memory:");
    seedDateThread(conversations);
    const { deps, sendText, events } = makeDeps({ conversations, parseReturns: [sampleEvent] });

    await handleInbound({ ...textMsg, text: "x".repeat(4001) }, deps); // > MAX_INPUT (4000)

    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("לנסח"));
    expect(events.saveEvent).not.toHaveBeenCalled(); // never reached the parse/save (no unbounded model call)
    expect(conversations.getPending(textMsg.from, NOW)?.kind).toBe("clarify"); // resume not reached → thread intact
  });

  it("F2: a TransientError during the re-parse leaves the thread OPEN for boot-replay (draft not dropped)", async () => {
    const conversations = createConversationStore(":memory:");
    seedDateThread(conversations);
    const { deps, events } = makeDeps({
      conversations,
      parseThrows: new TransientError("provider blip"),
    });

    // the error propagates (→ processInbound leaves the inbound pending) and the thread is NOT consumed.
    await expect(handleInbound({ ...textMsg, text: "ביום ראשון" }, deps)).rejects.toBeInstanceOf(
      TransientError,
    );
    expect(events.saveEvent).not.toHaveBeenCalled();
    expect(conversations.getPending(textMsg.from, NOW)?.kind).toBe("clarify"); // still open → replay can retry
  });

  it("F3: a corrupt persisted payload degrades to REPHRASE (consumed, nothing saved, no crash)", async () => {
    const conversations = createConversationStore(":memory:");
    // a draft missing required slots is not a valid ParsedEvent → clarifyPayloadSchema rejects it.
    conversations.create({
      fromPhone: textMsg.from,
      payload: {
        kind: "clarify",
        reason: "missing_date",
        draft: { kind: "event" } as unknown as ParsedEvent,
      },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events } = makeDeps({ conversations, parseReturns: [sampleEvent] });

    await handleInbound({ ...textMsg, text: "ביום ראשון" }, deps);

    expect(events.saveEvent).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("לנסח"));
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // consumed (can't complete a corrupt row)
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

// #85 (Milestone #8): cancel by reference — a deterministic route (no model call) with 0/1/N behavior
// and a numbered disambiguation thread. Family-scoped + state-not-content + single-use resume.
describe("handleInbound — #85 cancel by reference", () => {
  const NOW = "2026-06-20 09:00:00";
  const cand = (id: number, title: string, time: string): SavedEvent => ({
    ...sampleEvent,
    id,
    title_he: title,
    time,
    source_provider: null,
  });

  it("0 matches → 'not found', deletes nothing (state-not-content)", async () => {
    const { deps, sendText, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([]);
    await handleInbound({ ...textMsg, text: "בטל את הפגישה ב-3:30" }, deps);
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("לא מצאתי"));
    expect(events.deleteById).not.toHaveBeenCalled();
  });

  it("1 match → deletes that board row and confirms בוטל ✓", async () => {
    const { deps, sendText, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([cand(42, "פגישה", "15:30")]);
    events.deleteById.mockReturnValue(1);
    await handleInbound({ ...textMsg, text: "בטל פגישה" }, deps);
    expect(events.deleteById).toHaveBeenCalledWith(42, "default");
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("בוטל ✓"));
  });

  it("N>1 matches → opens a numbered thread, deletes nothing yet (never auto-pick)", async () => {
    const conversations = createConversationStore(":memory:");
    const { deps, sendText, events } = makeDeps({ conversations });
    events.findEventsByRef.mockReturnValue([cand(1, "פגישה", "15:30"), cand(2, "פגישה", "15:30")]);
    await handleInbound({ ...textMsg, text: "בטל פגישה" }, deps);
    expect(events.deleteById).not.toHaveBeenCalled();
    expect(sendText.mock.calls[0]?.[1]).toContain("איזה מהם");
    const pending = conversations.getPending(textMsg.from, NOW);
    expect(pending?.kind).toBe("cancel");
    expect(JSON.parse(pending?.payload_json ?? "{}").candidateIds).toEqual([1, 2]);
  });

  it("resume: a numbered reply deletes exactly that candidate (single-use)", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "cancel", candidateIds: [11, 22] },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events } = makeDeps({ conversations });
    events.deleteById.mockReturnValue(1);
    await handleInbound({ ...textMsg, text: "2" }, deps);
    expect(events.deleteById).toHaveBeenCalledWith(22, "default"); // index 2 → candidateIds[1]
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("בוטל ✓"));
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // resolved → redelivered '2' is a no-op
  });

  it("resume: a NON-index reply deletes nothing (G20)", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "cancel", candidateIds: [11, 22] },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events } = makeDeps({ conversations });
    await handleInbound({ ...textMsg, text: "לא יודע" }, deps);
    expect(events.deleteById).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("לנסח"));
  });

  it("bare ביטול while a thread is open ABORTS it — no last-message undo (§2)", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "cancel", candidateIds: [11] },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events } = makeDeps({ conversations });
    await handleInbound({ ...textMsg, text: "ביטול" }, deps);
    expect(events.deleteLastFromSender).not.toHaveBeenCalled(); // open op takes precedence
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // thread aborted
    expect(sendText.mock.calls[0]?.[1]).toContain("ביטלתי");
  });
});
