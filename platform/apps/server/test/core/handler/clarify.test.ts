import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { TransientError } from "../../../src/core/errors.ts";
import { handleInbound } from "../../../src/core/handler/index.ts";
import {
  type ConversationStore,
  createConversationStore,
} from "../../../src/db/conversation-store.ts";
import type { ClarifyResult } from "../../../src/tools/index.ts";
import { makeDeps, sampleEvent, textMsg } from "./_setup.ts";

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

  // #87/G24: the TTL is an injectable config (HandlerDeps.conversationTtlMs, env CONVERSATION_TTL_MIN),
  // read at thread-CREATE time. conversationTtlMs:0 ⇒ expiresAt === now ⇒ the thread is born expired:
  // getPending hides it (expires_at > now) and expireStale sweeps it (expires_at <= now). This is the
  // seam a test uses to force expiry without juggling two clocks.
  it("respects an injected conversationTtlMs:0 — the opened thread is immediately expired", async () => {
    const NOW = "2026-06-20 09:00:00";
    const conversations = createConversationStore(":memory:");
    const { deps } = makeDeps({ conversations, clarifyResult, conversationTtlMs: 0 });

    await handleInbound(textMsg, deps);

    expect(conversations.getPending(textMsg.from, NOW)).toBeNull(); // born expired → invisible at read
    expect(conversations.expireStale(NOW)).toBe(1); // …and swept by the boot/per-inbound sweep
  });

  it("respects an injected conversationTtlMs — a future TTL keeps the thread answerable", async () => {
    const NOW = "2026-06-20 09:00:00";
    const conversations = createConversationStore(":memory:");
    const { deps } = makeDeps({ conversations, clarifyResult, conversationTtlMs: 5 * 60_000 });

    await handleInbound(textMsg, deps);

    expect(conversations.getPending(textMsg.from, NOW)?.kind).toBe("clarify"); // open for 5 min
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
