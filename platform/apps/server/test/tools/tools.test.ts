import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { EventMeta, EventStore, SavedEvent } from "../../src/db/event-store.ts";
import { extractEventsTool, type ToolContext } from "../../src/tools/tools.ts";

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

// A fake EventStore that records saveEvent + returns a SavedEvent (the row the tool now persists, #71).
function makeStore() {
  let id = 0;
  const saveEvent = vi.fn(
    (e: ParsedEvent, m: EventMeta): SavedEvent => ({
      id: ++id,
      source_provider: m.sourceProvider ?? null,
      ...e,
    }),
  );
  const store = {
    saveEvent,
    listEvents: vi.fn(() => []),
    deleteLastFromSender: vi.fn(() => 0),
    countSince: vi.fn(() => 0),
    deleteByProvider: vi.fn(() => 0),
  } as unknown as EventStore;
  return { store, saveEvent };
}

function makeCtx(over: Partial<ToolContext> = {}) {
  const { store, saveEvent } = makeStore();
  const ctx: ToolContext = {
    todayIso: "2026-06-20",
    from: "972501234567",
    waMessageId: "wamid.1",
    familyId: "default",
    events: store,
    ...over,
  };
  return { ctx, saveEvent };
}

describe("extractEventsTool", () => {
  it("has the declarative tool shape (name, description, zod inputSchema)", () => {
    const tool = extractEventsTool(vi.fn());
    expect(tool.name).toBe("extract_events");
    expect(typeof tool.description).toBe("string");
    expect(tool.inputSchema.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("delegates to the injected ParseMessage with ctx.todayIso, then persists what it saved", async () => {
    const parse = vi.fn(async () => [sampleEvent]);
    const { ctx, saveEvent } = makeCtx();
    const out = await extractEventsTool(parse).run({ text: "אסיפת הורים מחר" }, ctx);

    expect(parse).toHaveBeenCalledWith("אסיפת הורים מחר", "2026-06-20", undefined);
    // #71: the TOOL persists under the inbound's own key — fromPhone/waMessageId from ctx (G8), seq 0.
    expect(saveEvent).toHaveBeenCalledWith(sampleEvent, {
      fromPhone: "972501234567",
      waMessageId: "wamid.1",
      seq: 0,
    });
    expect(out.saved).toEqual([{ id: 1, source_provider: null, ...sampleEvent }]);
  });

  it("passes the server-supplied senderName to parse (first-person → assignee, G8/#14)", async () => {
    const parse = vi.fn(async () => [sampleEvent]);
    const { ctx } = makeCtx({ senderName: "אבא" });
    await extractEventsTool(parse).run({ text: "יש לי פיזיותרפיה" }, ctx);
    expect(parse).toHaveBeenCalledWith("יש לי פיזיותרפיה", "2026-06-20", "אבא");
  });

  it("maps a null parse (unparseable) to an empty saved list — nothing persisted", async () => {
    const { ctx, saveEvent } = makeCtx();
    const out = await extractEventsTool(vi.fn(async () => null)).run({ text: "???" }, ctx);
    expect(out.saved).toEqual([]);
    expect(saveEvent).not.toHaveBeenCalled();
  });

  it("persists every event of a multi-event parse under its own seq, tagged as a forward (source_provider null)", async () => {
    const second: ParsedEvent = { ...sampleEvent, title_he: "טיול שנתי", time: null };
    const parse = vi.fn(async () => [sampleEvent, second]);
    const { ctx, saveEvent } = makeCtx();
    const out = await extractEventsTool(parse).run({ text: "two" }, ctx);

    expect(saveEvent).toHaveBeenCalledTimes(2);
    expect(saveEvent.mock.calls[0]![1]).toEqual({
      fromPhone: "972501234567",
      waMessageId: "wamid.1",
      seq: 0,
    });
    expect(saveEvent.mock.calls[1]![1]).toEqual({
      fromPhone: "972501234567",
      waMessageId: "wamid.1",
      seq: 1,
    });
    expect(out.saved).toHaveLength(2);
    expect(out.saved.map((e) => e.source_provider)).toEqual([null, null]); // forwards, not provider rows
  });

  it("rejects missing / empty / oversized text via inputSchema (a structured error, not a throw)", () => {
    const tool = extractEventsTool(vi.fn());
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    expect(tool.inputSchema.safeParse({ text: "" }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ text: "a".repeat(8001) }).success).toBe(false);
  });

  it("converts inputSchema to a valid object-root JSON Schema (z.toJSONSchema)", () => {
    const tool = extractEventsTool(vi.fn());
    const json = z.toJSONSchema(tool.inputSchema) as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expect(json.type).toBe("object");
    expect(json.properties).toHaveProperty("text");
  });
});
