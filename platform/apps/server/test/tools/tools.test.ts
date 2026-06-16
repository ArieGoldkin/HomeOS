import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { extractEventsTool, type ToolContext } from "../../src/tools/tools.ts";

const ctx: ToolContext = { todayIso: "2026-06-20", from: "972501234567", waMessageId: "wamid.1" };

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

describe("extractEventsTool", () => {
  it("has the declarative tool shape (name, description, zod inputSchema)", () => {
    const tool = extractEventsTool(vi.fn());
    expect(tool.name).toBe("extract_events");
    expect(typeof tool.description).toBe("string");
    expect(tool.inputSchema.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("delegates to the injected ParseMessage with ctx.todayIso (never model-supplied)", async () => {
    const parse = vi.fn(async () => [sampleEvent]);
    const tool = extractEventsTool(parse);
    const out = await tool.run({ text: "אסיפת הורים מחר" }, ctx);
    expect(parse).toHaveBeenCalledWith("אסיפת הורים מחר", "2026-06-20");
    expect(out.events).toEqual([sampleEvent]);
  });

  it("maps a null parse (unparseable) to an empty events list", async () => {
    const tool = extractEventsTool(vi.fn(async () => null));
    expect((await tool.run({ text: "???" }, ctx)).events).toEqual([]);
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
