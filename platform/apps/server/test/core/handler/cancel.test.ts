import { describe, expect, it } from "vitest";
import { extractCancelRef, handleInbound } from "../../../src/core/handler/index.ts";
import { createConversationStore } from "../../../src/db/conversation-store.ts";
import type { SavedEvent } from "../../../src/db/event-store.ts";
import { makeDeps, sampleEvent, textMsg } from "./_setup.ts";

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
    // #87/G24 default arm: with no conversationTtlMs wired, the route applies the 30-min default
    // (NOW 09:00 → 09:30) via conversationExpiresAt(deps) — proves the cancel writer's TTL computation.
    expect(pending?.expires_at).toBe("2026-06-20 09:30:00");
  });

  it("#87/G24: the disambiguation thread respects an injected conversationTtlMs:0 (born expired)", async () => {
    const conversations = createConversationStore(":memory:");
    const { deps, events } = makeDeps({ conversations, conversationTtlMs: 0 });
    events.findEventsByRef.mockReturnValue([cand(1, "פגישה", "15:30"), cand(2, "פגישה", "15:30")]);

    await handleInbound({ ...textMsg, text: "בטל פגישה" }, deps);

    // expiresAt === now ⇒ getPending hides it immediately and expireStale sweeps it (the cancel route
    // reads the injected TTL, not the hardcoded default).
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull();
    expect(conversations.expireStale(NOW)).toBe(1);
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

// Regression (live bug 2026-06-21): "טוב בטל את הפגישה מחר עם יונתן" CREATED a new "ביטול …" event
// instead of cancelling — a leading conversational filler ("טוב") defeated the ^-anchored cancel route,
// so the message fell through to agent.run and was parsed as a fresh event. A cancel command must route
// regardless of a leading filler word or an inflected verb, and must NEVER reach the model.
describe("handleInbound — #85 cancel routing robustness (regression)", () => {
  const cand = (id: number, title: string, time: string): SavedEvent => ({
    ...sampleEvent,
    id,
    title_he: title,
    time,
    source_provider: null,
  });

  it("a leading filler ('טוב …') still routes to cancel, never the model", async () => {
    const { deps, agent, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([cand(42, "פגישה עם יונתן המסטר של AI", "12:00")]);
    events.deleteById.mockReturnValue(1);
    await handleInbound({ ...textMsg, text: "טוב בטל את הפגישה מחר עם יונתן" }, deps);
    expect(agent.run).not.toHaveBeenCalled(); // not parsed as a NEW event
    expect(events.findEventsByRef).toHaveBeenCalled();
    expect(events.deleteById).toHaveBeenCalledWith(42, "default");
  });

  it("an inflected verb ('תבטל …') routes to cancel", async () => {
    const { deps, agent, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([cand(7, "פגישה", "12:00")]);
    await handleInbound({ ...textMsg, text: "תבטל את הפגישה מחר" }, deps);
    expect(agent.run).not.toHaveBeenCalled();
    expect(events.findEventsByRef).toHaveBeenCalled();
  });

  it("a leading filler passes the CLEANED reference (resolved date) to findEventsByRef", async () => {
    const { deps, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([]);
    await handleInbound({ ...textMsg, text: "אוקיי בטל את הפגישה מחר" }, deps);
    expect(events.findEventsByRef).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ dateIso: "2026-06-21" }), // מחר from 2026-06-20
    );
  });

  it("a leading filler also routes the edit command (never the model)", async () => {
    const { deps, agent, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([]); // not found → still routed, not modeled
    await handleInbound({ ...textMsg, text: "טוב שנה את הפגישה ל-13:00" }, deps);
    expect(agent.run).not.toHaveBeenCalled();
  });
});

describe("extractCancelRef + cancel specificity (#125/F1+F2)", () => {
  const TODAY = "2026-06-20"; // a Saturday

  it("pulls an explicit time, hour zero-padded", () => {
    expect(extractCancelRef("בטל פגישה ב-3:30", TODAY)).toMatchObject({ time: "03:30" });
  });

  it("resolves היום / מחר / מחרתיים and strips them from the hint", () => {
    expect(extractCancelRef("בטל את הפגישה היום", TODAY).dateIso).toBe("2026-06-20");
    expect(extractCancelRef("בטל את הפגישה מחר", TODAY).dateIso).toBe("2026-06-21");
    expect(extractCancelRef("בטל את הפגישה מחרתיים", TODAY).dateIso).toBe("2026-06-22");
    expect(extractCancelRef("בטל מחר", TODAY).titleHint).toBeUndefined();
  });

  it("resolves a weekday to its NEXT occurrence (ביום ראשון from a Saturday → tomorrow)", () => {
    expect(extractCancelRef("בטל את הפגישה ביום ראשון", TODAY).dateIso).toBe("2026-06-21");
  });

  it("yields nothing matchable for a bare/stopword-only reference", () => {
    expect(extractCancelRef("בטל את", TODAY)).toEqual({});
  });

  it("strips an inflected/prefixed verb form from the hint (תבטל/לבטל/תמחק)", () => {
    expect(extractCancelRef("תבטל את הפגישה", TODAY).titleHint).toBe("הפגישה");
    expect(extractCancelRef("לבטל את הפגישה", TODAY).titleHint).toBe("הפגישה");
    expect(extractCancelRef("תמחק את הפגישה", TODAY).titleHint).toBe("הפגישה");
  });

  it("F1: a stopword-only 'בטל את' matches NOTHING — no findEventsByRef, no delete", async () => {
    const { deps, sendText, events } = makeDeps();
    await handleInbound({ ...textMsg, text: "בטל את" }, deps);
    expect(events.findEventsByRef).not.toHaveBeenCalled();
    expect(events.deleteById).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(textMsg.from, expect.stringContaining("לא מצאתי"));
  });

  it("F2: a date-bearing cancel passes the resolved date to findEventsByRef", async () => {
    const { deps, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([]);
    await handleInbound({ ...textMsg, text: "בטל את הפגישה מחר" }, deps);
    expect(events.findEventsByRef).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({ dateIso: "2026-06-21" }),
    );
  });
});
