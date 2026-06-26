import { describe, expect, it } from "vitest";
import { handleInbound } from "../../../src/core/handler/index.ts";
import { createConversationStore } from "../../../src/db/conversation-store.ts";
import type { SavedEvent } from "../../../src/db/event-store/index.ts";
import { makeDeps, sampleEvent, textMsg } from "./_setup.ts";

// #86 (Milestone #8): edit in place + the pending-context correction (THE live 2-reminder bug fix).
describe("handleInbound — #86 edit in place + correction", () => {
  const NOW = "2026-06-20 09:00:00";
  const board = (id: number, over: Partial<SavedEvent> = {}): SavedEvent => ({
    ...sampleEvent,
    id,
    source_provider: null,
    ...over,
  });

  it("explicit edit, 1 match → updateEvent applies the delta + עודכן ✓", async () => {
    const { deps, sendText, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([board(42, { title_he: "פגישה", time: "16:00" })]);
    events.updateEvent.mockReturnValue(board(42, { title_he: "פגישה", time: "18:00" }));
    await handleInbound({ ...textMsg, text: "שנה את הפגישה ל-18:00" }, deps);
    expect(events.updateEvent).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ time: "18:00" }),
      "default",
    );
    expect(sendText.mock.calls[0]?.[1]).toContain("עודכן ✓");
  });

  it("explicit edit on a SYNCED ('google') target → refusal, NO write", async () => {
    const { deps, sendText, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([board(7, { source_provider: "google" })]);
    await handleInbound({ ...textMsg, text: "שנה את הפגישה ל-18:00" }, deps);
    expect(events.updateEvent).not.toHaveBeenCalled();
    expect(sendText.mock.calls[0]?.[1]).toContain("מסונכרן מהיומן");
  });

  it("explicit edit, N>1 → opens an edit thread holding the patch (no write yet)", async () => {
    const conversations = createConversationStore(":memory:");
    const { deps, events } = makeDeps({ conversations });
    events.findEventsByRef.mockReturnValue([
      board(1, { title_he: "פגישה" }),
      board(2, { title_he: "פגישה" }),
    ]);
    await handleInbound({ ...textMsg, text: "שנה פגישה ל-18:00" }, deps);
    expect(events.updateEvent).not.toHaveBeenCalled();
    const pending = conversations.getPending(textMsg.from, NOW);
    expect(pending?.kind).toBe("edit");
    expect(JSON.parse(pending?.payload_json ?? "{}").patch).toMatchObject({ time: "18:00" });
    // #87/G24 default arm: the edit route applies the 30-min default (NOW 09:00 → 09:30) via
    // conversationExpiresAt(deps) — proves the edit writer's TTL computation.
    expect(pending?.expires_at).toBe("2026-06-20 09:30:00");
  });

  it("#87/G24: the edit disambiguation thread respects an injected conversationTtlMs:0 (born expired)", async () => {
    const conversations = createConversationStore(":memory:");
    const { deps, events } = makeDeps({ conversations, conversationTtlMs: 0 });
    events.findEventsByRef.mockReturnValue([
      board(1, { title_he: "פגישה" }),
      board(2, { title_he: "פגישה" }),
    ]);

    await handleInbound({ ...textMsg, text: "שנה פגישה ל-18:00" }, deps);

    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // expiresAt === now → hidden at read
    expect(conversations.expireStale(NOW)).toBe(1); // …and swept (the edit route read the injected TTL)
  });

  it("edit resume: a numbered reply applies the held patch to that candidate", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "edit", candidateIds: [11, 22], patch: { time: "18:00" } },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, events } = makeDeps({ conversations });
    events.updateEvent.mockReturnValue(board(22, { time: "18:00" }));
    await handleInbound({ ...textMsg, text: "2" }, deps);
    expect(events.updateEvent).toHaveBeenCalledWith(
      22,
      expect.objectContaining({ time: "18:00" }),
      "default",
    );
  });

  // #161 — edit disambiguation shares the multi-select parser with cancel: a single reply may pick more
  // than one candidate ("1,2", "1 ו-2") or הכל/כולם → apply the held patch to ALL of them, ONE summary,
  // never falling through to agent.run.
  it("edit resume '1,2' applies the held patch to BOTH and sends one summary (עודכנו 2)", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "edit", candidateIds: [11, 22, 33], patch: { time: "18:00" } },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events, agent } = makeDeps({ conversations });
    events.updateEvent.mockImplementation((id: number) => board(id, { time: "18:00" }));
    await handleInbound({ ...textMsg, text: "1,2" }, deps);
    expect(events.updateEvent).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ time: "18:00" }),
      "default",
    );
    expect(events.updateEvent).toHaveBeenCalledWith(
      22,
      expect.objectContaining({ time: "18:00" }),
      "default",
    );
    expect(events.updateEvent).not.toHaveBeenCalledWith(33, expect.anything(), "default");
    expect(sendText).toHaveBeenCalledTimes(1); // one summary, not N replies
    expect(sendText.mock.calls[0]?.[1]).toContain("עודכנו 2");
    expect(agent.run).not.toHaveBeenCalled();
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // single-use
  });

  it("edit resume 'הכל' applies the held patch to EVERY candidate", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "edit", candidateIds: [11, 22, 33], patch: { location: "זום" } },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events } = makeDeps({ conversations });
    events.updateEvent.mockImplementation((id: number) => board(id, { location: "זום" }));
    await handleInbound({ ...textMsg, text: "הכל" }, deps);
    expect(events.updateEvent).toHaveBeenCalledTimes(3);
    expect(sendText.mock.calls[0]?.[1]).toContain("עודכנו 3");
  });

  it("edit disambiguation prompt asks לעדכן (not לבטל) and invites multi-select", async () => {
    const conversations = createConversationStore(":memory:");
    const { deps, sendText, events } = makeDeps({ conversations });
    events.findEventsByRef.mockReturnValue([
      board(1, { title_he: "פגישה" }),
      board(2, { title_he: "פגישה" }),
    ]);
    await handleInbound({ ...textMsg, text: "שנה פגישה ל-18:00" }, deps);
    const prompt = sendText.mock.calls[0]?.[1] ?? "";
    expect(prompt).toContain("לעדכן");
    expect(prompt).not.toContain("לבטל");
    expect(prompt).toContain("הכל");
  });

  it("CORRECTION 'לא ב-28, ב-21' in an open clarify thread completes the draft IN PLACE (one save, not a 2nd event)", async () => {
    const conversations = createConversationStore(":memory:");
    const draft = {
      ...sampleEvent,
      date_iso: "2026-06-28",
      needs_clarification: { reason: "missing_date" as const },
    };
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "clarify", reason: "missing_date", draft },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, events, agent } = makeDeps({ conversations });
    await handleInbound({ ...textMsg, text: "לא ב-28, ב-21" }, deps);
    expect(agent.run).not.toHaveBeenCalled(); // deterministic, no re-parse
    expect(events.saveEvent).toHaveBeenCalledTimes(1); // ONE save (the corrected draft), not a duplicate
    expect(events.saveEvent.mock.calls[0]?.[0].date_iso).toBe("2026-06-21"); // corrected to the 21st
  });

  it("a correction with NO open thread does NOT mutate any event (falls through to agent.run)", async () => {
    const { deps, events, agent } = makeDeps(); // no conversations
    await handleInbound({ ...textMsg, text: "לא ב-28, ב-21" }, deps);
    expect(events.updateEvent).not.toHaveBeenCalled();
    expect(agent.run).toHaveBeenCalled(); // no heuristic re-targeting — just a normal parse
  });

  it("false-positive 'לא נשכח … ביום שישי' with an open thread is treated as a NEW forward", async () => {
    const conversations = createConversationStore(":memory:");
    const draft = { ...sampleEvent, needs_clarification: { reason: "missing_date" as const } };
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "clarify", reason: "missing_date", draft },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, agent } = makeDeps({ conversations });
    await handleInbound({ ...textMsg, text: "לא נשכח את יום ההולדת ביום שישי" }, deps);
    expect(agent.run).toHaveBeenCalled(); // thread aborted → processed as a new forward
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // thread aborted
  });
});

// #147 — the agentic edit fallback: deterministic 0-match → resolve over title+location+assignee → CONFIRM
// (holding the patch) before writing; fail-closed כן/לא.
describe("handleInbound — #147 agentic edit fallback + confirm-before-edit", () => {
  const NOW = "2026-06-20 09:00:00";
  const board = (id: number, over: Partial<SavedEvent> = {}): SavedEvent => ({
    ...sampleEvent,
    id,
    source_provider: null,
    ...over,
  });

  it("deterministic 0-match → agentic resolve → edit confirm thread holds the patch, no write yet", async () => {
    const conversations = createConversationStore(":memory:");
    const resolved = [board(42, { title_he: "פגישה", assignee: "יונתן" })];
    const { deps, sendText, events, agent, resolveRun } = makeDeps({ conversations, resolved });
    events.findEventsByRef.mockReturnValue([]); // title-only strict match misses the assignee

    await handleInbound({ ...textMsg, text: "שנה את הפגישה עם יונתן ל-18:00" }, deps);

    expect(agent.run).not.toHaveBeenCalled();
    expect(resolveRun).toHaveBeenCalled();
    expect(events.updateEvent).not.toHaveBeenCalled(); // confirm first
    expect(sendText.mock.calls[0]?.[1]).toContain("לעדכן");
    const pending = conversations.getPending(textMsg.from, NOW);
    expect(pending?.kind).toBe("edit");
    const payload = JSON.parse(pending?.payload_json ?? "{}");
    expect(payload.candidateIds).toEqual([42]);
    expect(payload.patch).toMatchObject({ time: "18:00" }); // held until confirmed
  });

  it("confirm כן → applies the held patch to that candidate", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "edit", candidateIds: [42], patch: { time: "18:00" } },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events } = makeDeps({ conversations });
    events.updateEvent.mockReturnValue(board(42, { time: "18:00" }));

    await handleInbound({ ...textMsg, text: "כן" }, deps);

    expect(events.updateEvent).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ time: "18:00" }),
      "default",
    );
    expect(sendText.mock.calls[0]?.[1]).toContain("עודכן ✓");
    expect(conversations.getPending(textMsg.from, NOW)).toBeNull();
  });

  it("confirm לא → NO write (fail-closed)", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "edit", candidateIds: [42], patch: { time: "18:00" } },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, sendText, events } = makeDeps({ conversations });

    await handleInbound({ ...textMsg, text: "לא" }, deps);

    expect(events.updateEvent).not.toHaveBeenCalled();
    expect(sendText.mock.calls[0]?.[1]).toContain("השארתי");
  });

  // #164 — the broadened affirmative set reaches the edit confirm too (shared isAffirmative predicate).
  it("#164: 'בטח' confirms a pending edit → applies the held patch", async () => {
    const conversations = createConversationStore(":memory:");
    conversations.create({
      fromPhone: textMsg.from,
      payload: { kind: "edit", candidateIds: [42], patch: { time: "18:00" } },
      expiresAt: "2026-06-20 12:00:00",
    });
    const { deps, events } = makeDeps({ conversations });
    events.updateEvent.mockReturnValue(board(42, { time: "18:00" }));

    await handleInbound({ ...textMsg, text: "בטח" }, deps);

    expect(events.updateEvent).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ time: "18:00" }),
      "default",
    );
  });
});

describe("extractEditDelta location bound (#126/F2)", () => {
  it("a location delta does NOT swallow a trailing time token", async () => {
    const { deps, events } = makeDeps();
    events.findEventsByRef.mockReturnValue([
      { ...sampleEvent, id: 9, source_provider: null } as SavedEvent,
    ]);
    events.updateEvent.mockReturnValue({
      ...sampleEvent,
      id: 9,
      source_provider: null,
    } as SavedEvent);
    await handleInbound({ ...textMsg, text: "שנה את הפגישה למיקום בית הספר ל-18:00" }, deps);
    expect(events.updateEvent).toHaveBeenCalledWith(
      9,
      { location: "בית הספר", time: "18:00" }, // both extracted; the time is NOT swallowed into location
      "default",
    );
  });
});
