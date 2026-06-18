import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { TransientError } from "../../src/core/errors.ts";
import type { EventMeta, EventStore, SavedEvent } from "../../src/db/event-store.ts";
import {
  buildGmailQuery,
  extractEventsTool,
  type GmailToolDeps,
  readGmailTool,
  type ToolContext,
} from "../../src/tools/tools.ts";

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

// A fake Gmail seam: a connected credential (non-expired), a mock read client, mock oauth client.
function makeGoogle(over: Record<string, unknown> = {}): GmailToolDeps {
  return {
    client: {
      list: vi.fn(async () => []),
      get: vi.fn(async (_t: string, id: string) => ({
        id,
        subject: `subj ${id}`,
        bodyText: `body ${id}`,
      })),
    },
    oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
    credentials: {
      get: vi.fn(() => ({
        accessToken: "acc",
        refreshToken: "ref",
        expiry: "2099-01-01 00:00:00",
        scopes: [],
      })),
      updateTokens: vi.fn(),
      delete: vi.fn(),
    },
    maxMessages: 10,
    queryWindow: "newer_than:7d",
    allowedLabels: ["family"],
    ...over,
  } as unknown as GmailToolDeps;
}

describe("buildGmailQuery (server-clamped, G8)", () => {
  it("always applies the recency window", () => {
    expect(buildGmailQuery({}, { queryWindow: "newer_than:7d" })).toBe("newer_than:7d");
  });
  it("honours an allowlisted label and drops a non-allowlisted one", () => {
    const deps = { queryWindow: "newer_than:7d", allowedLabels: ["family"] };
    expect(buildGmailQuery({ label: "family" }, deps)).toBe("newer_than:7d label:family");
    expect(buildGmailQuery({ label: "evil" }, deps)).toBe("newer_than:7d");
  });
  it("sanitises fromSender so the model can't inject Gmail operators", () => {
    expect(
      buildGmailQuery({ fromSender: "a@b.com OR is:starred" }, { queryWindow: "newer_than:7d" }),
    ).toBe("newer_than:7d from:a@b.comORisstarred");
  });
});

describe("readGmailTool (#72)", () => {
  it("is opt-in: no ctx.google → { saved: [] }, zero parse calls", async () => {
    const parse = vi.fn();
    const { ctx } = makeCtx();
    expect((await readGmailTool(parse).run({}, ctx)).saved).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it("not connected (no credential) → { saved: [] }, ZERO Gmail and parse calls", async () => {
    const google = makeGoogle({
      credentials: { get: vi.fn(() => null), updateTokens: vi.fn(), delete: vi.fn() },
    });
    const parse = vi.fn();
    const { ctx } = makeCtx({ google });
    expect((await readGmailTool(parse).run({}, ctx)).saved).toEqual([]);
    expect(google.client.list).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("connected: lists → fetches → parses subject+body → persists under gmail:<id> tagged google", async () => {
    const google = makeGoogle({
      client: {
        list: vi.fn(async () => [
          { id: "m1", threadId: "t1" },
          { id: "m2", threadId: "t2" },
        ]),
        get: vi.fn(async (_t: string, id: string) => ({
          id,
          subject: `subj ${id}`,
          bodyText: `body ${id}`,
        })),
      },
    });
    const parse = vi.fn(async () => [sampleEvent]);
    const { ctx, saveEvent } = makeCtx({ google });
    const out = await readGmailTool(parse).run({}, ctx);

    expect(google.client.list).toHaveBeenCalledWith("acc", "newer_than:7d", 10);
    expect(parse).toHaveBeenCalledWith("subj m1\nbody m1", "2026-06-20", undefined);
    expect(saveEvent).toHaveBeenCalledWith(sampleEvent, {
      fromPhone: "972501234567",
      waMessageId: "gmail:m1",
      seq: 0,
      sourceProvider: "google",
    });
    expect(out.saved).toHaveLength(2);
    expect(out.saved.every((e) => e.source_provider === "google")).toBe(true);
  });

  it("clamps the model's query hints (label allowlisted + fromSender sanitised)", async () => {
    const google = makeGoogle({
      allowedLabels: ["gan"],
      client: { list: vi.fn(async () => []), get: vi.fn() },
    });
    const { ctx } = makeCtx({ google });
    await readGmailTool(vi.fn()).run({ label: "gan", fromSender: "teacher@gan.il; DROP" }, ctx);
    expect(google.client.list).toHaveBeenCalledWith(
      "acc",
      "newer_than:7d label:gan from:teacher@gan.ilDROP",
      10,
    );
  });

  it("propagates a Gmail TransientError out of run (→ inbound row stays pending)", async () => {
    const google = makeGoogle({
      client: {
        list: vi.fn(async () => {
          throw new TransientError("gmail 429");
        }),
        get: vi.fn(),
      },
    });
    const { ctx } = makeCtx({ google });
    await expect(readGmailTool(vi.fn()).run({}, ctx)).rejects.toBeInstanceOf(TransientError);
  });
});
