import { describe, expect, it, vi } from "vitest";
import type { ProcessDeps } from "../../../src/core/handler/index.ts";
import { handleInbound, processInbound } from "../../../src/core/handler/index.ts";
import {
  type ConversationPayload,
  type ConversationStore,
  createConversationStore,
} from "../../../src/db/conversation-store.ts";
import { makeDeps, sampleEvent, textMsg } from "./_setup.ts";

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

  // #207 — a fresh VERB-LED command (cancel/edit) while a thread is open must take precedence: it
  // aborts the thread and routes as a command, never gets swallowed as the thread's answer. The live bug:
  // "תבטל את הגישה עם רות מחר" sent during an open clarify was consumed as the title → a junk event named
  // with the cancel sentence was created.
  it("routes a verb-led cancel command as a CANCEL (not the thread answer) and creates no event", async () => {
    const conversations = createConversationStore(":memory:");
    seed(conversations, FUTURE); // a clarify thread is open
    const { deps, sendText, events } = makeDeps({ conversations });

    await handleInbound({ ...textMsg, text: "תבטל את הגישה עם רות מחר" }, deps);

    expect(events.findEventsByRef).toHaveBeenCalled(); // the cancel route engaged
    expect(events.saveEvent).not.toHaveBeenCalled(); // NOT swallowed as a clarify title → no junk event
    expect(conversations.getPending(textMsg.from, NOW_SQLITE)).toBeNull(); // open thread aborted
    expect(sendText.mock.calls[0]?.[1]).not.toContain("הוספתי"); // not an add-confirm
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
      listRecent: vi.fn(() => []),
      statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
      countFromSenderSince: vi.fn(() => 0),
    };

    await processInbound(textMsg, { ...deps, inbound } as unknown as ProcessDeps);

    // #135 — a resume is a command path (not a fresh parse), so the outcome is null (undefined arg).
    expect(inbound.markDone).toHaveBeenCalledWith("wamid.1", undefined);
    expect(agent.run).not.toHaveBeenCalled();
  });
});
