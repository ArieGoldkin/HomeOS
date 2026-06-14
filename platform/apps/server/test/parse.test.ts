import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicRawParse, buildSystemPrompt, createParser, type RawParse } from "../src/parse.ts";

const validRaw = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  source_text: "אסיפת הורים מחר ב-18:30 בגן רימון",
};

describe("buildSystemPrompt", () => {
  it("anchors to today's Jerusalem date", () => {
    const p = buildSystemPrompt("2026-06-20");
    expect(p).toContain("2026-06-20");
    expect(p).toMatch(/Jerusalem/);
  });
});

describe("createParser", () => {
  it("returns a validated event and passes today's date to the model", async () => {
    const rawParse = vi.fn(async (_system: string, _text: string): Promise<unknown> => validRaw);
    const parse = createParser(rawParse);
    const result = await parse("אסיפת הורים מחר ב-18:30 בגן רימון", "2026-06-20");
    expect(result).toMatchObject({ kind: "event", date_iso: "2026-06-21", time: "18:30" });
    const [system] = rawParse.mock.calls[0]!;
    expect(system).toContain("2026-06-20");
  });

  it("returns null when the model output fails schema validation", async () => {
    const rawParse: RawParse = async () => ({ kind: "party", title_he: "" });
    expect(await createParser(rawParse)("???", "2026-06-20")).toBeNull();
  });

  it("returns null when the model output is null (refusal/empty)", async () => {
    const rawParse: RawParse = async () => null;
    expect(await createParser(rawParse)("???", "2026-06-20")).toBeNull();
  });

  it("returns null when the raw parse call throws", async () => {
    const rawParse: RawParse = async () => {
      throw new Error("network");
    };
    expect(await createParser(rawParse)("???", "2026-06-20")).toBeNull();
  });
});

describe("anthropicRawParse", () => {
  it("calls messages.parse with the configured model and returns parsed_output", async () => {
    const parse = vi.fn(async (_body: unknown) => ({ parsed_output: validRaw }));
    const client = { messages: { parse } } as unknown as Anthropic;
    const raw = anthropicRawParse(client, "claude-haiku-4-5");

    const out = await raw("system prompt", "forwarded text");

    expect(out).toEqual(validRaw);
    expect(parse).toHaveBeenCalledTimes(1);
    const body = parse.mock.calls[0]![0] as { model: string; output_config: unknown };
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config).toBeDefined(); // zodOutputFormat(schema) did not throw
  });
});
