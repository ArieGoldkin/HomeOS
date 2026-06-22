import { describe, expect, it, vi } from "vitest";
import { TransientError } from "../../../src/core/errors.ts";
import { handleInbound } from "../../../src/core/handler/index.ts";
import { createConversationStore } from "../../../src/db/conversation-store.ts";
import type { SavedEvent } from "../../../src/db/event-store.ts";
import type { InboundMessage } from "../../../src/http/webhook.ts";
import { makeDeps, sampleEvent, sampleSaved, textMsg } from "./_setup.ts";

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
      duplicates: [], // slot-dedup sink the handler wires into ToolContext
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
      duplicates: [],
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
      // #135 — the push failure is swallowed inside the best-effort push, so the handler still
      // completes and returns the "parsed" outcome (the event WAS saved + confirmed).
      await expect(handleInbound(textMsg, deps)).resolves.toBe("parsed");
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

    // G23: the rate ceiling × an open clarify/disambiguation thread. A resume-answer is not a new
    // intent, so a rate-limited sender must still be able to CLOSE an open thread — else the thread
    // strands until TTL. NOW is pinned to 2026-06-20 09:00:00 (sqliteUtc) by makeDeps.
    it("EXEMPTS a sender over the ceiling when they have a LIVE open thread (no strand)", async () => {
      const conversations = createConversationStore(":memory:");
      conversations.create({
        fromPhone: textMsg.from,
        payload: { kind: "clarify", reason: "ambiguous_title", draft: sampleEvent },
        expiresAt: "2026-06-20 12:00:00", // > NOW → open
      });
      const { sendText, agent, events, deps } = makeDeps({
        maxPerSenderPerDay: 50,
        senderCount: 51, // over the ceiling
        conversations,
      });

      await handleInbound(textMsg, deps);

      expect(agent.run).not.toHaveBeenCalled(); // routed to resume, not a fresh parse
      expect(events.saveEvent).toHaveBeenCalledTimes(1); // ambiguous_title answer → title → saved
      const bodies = sendText.mock.calls.map((c) => c[1]);
      expect(bodies.some((b) => /מכסת/.test(b))).toBe(false); // NOT rate-limited
      expect(bodies.some((b) => b.includes("הוספתי"))).toBe(true); // the thread closed (confirm)
      expect(conversations.getPending(textMsg.from, "2026-06-20 09:00:00")).toBeNull(); // resolved
    });

    it("still caps an over-ceiling sender whose thread already EXPIRED (no exemption)", async () => {
      const conversations = createConversationStore(":memory:");
      conversations.create({
        fromPhone: textMsg.from,
        payload: { kind: "clarify", reason: "ambiguous_title", draft: sampleEvent },
        expiresAt: "2026-06-20 08:00:00", // < NOW → expired, invisible to getPending
      });
      const { sendText, agent, deps } = makeDeps({
        maxPerSenderPerDay: 50,
        senderCount: 51,
        conversations,
      });

      await handleInbound(textMsg, deps);

      expect(agent.run).not.toHaveBeenCalled(); // rate-limited before any model call
      expect(sendText.mock.calls[0]![1]).toMatch(/מכסת|מחר/); // RATE_LIMIT_HE
    });
  });
});
