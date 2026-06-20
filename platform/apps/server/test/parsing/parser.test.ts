import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  anthropicRawParse,
  buildSystemPrompt,
  createParser,
  type RawParse,
} from "../../src/parsing/parser.ts";

const validEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: null,
  recurrence: null,
  source_text: "אסיפת הורים מחר ב-18:30 בגן רימון",
};
const validMessage = { events: [validEvent] };

describe("buildSystemPrompt", () => {
  it("anchors to today's Jerusalem date and asks for an events list", () => {
    const p = buildSystemPrompt("2026-06-20");
    expect(p).toContain("2026-06-20");
    expect(p).toMatch(/Jerusalem/);
    expect(p).toMatch(/events/);
  });

  it("adds the first-person→assignee nuance only when a sender name is given (#14)", () => {
    // "רוני" is not in the default prompt, so its presence proves the sender was threaded in.
    const withSender = buildSystemPrompt("2026-06-20", "רוני");
    expect(withSender).toContain("רוני");
    expect(withSender).toMatch(/sender/i);
    expect(buildSystemPrompt("2026-06-20")).not.toContain("רוני"); // absent by default
  });

  it("instructs a CONSERVATIVE needs_clarification on required-slot guesses only (#84)", () => {
    // Lock the prompt contract: it names the field, both required-slot reasons, and the OMIT default.
    // (Real-model conservativeness is the #87 eval's job; here we only assert the instruction is present.)
    const p = buildSystemPrompt("2026-06-20");
    expect(p).toContain("needs_clarification");
    expect(p).toContain("missing_date");
    expect(p).toContain("ambiguous_title");
    expect(p).toMatch(/OMIT/);
    expect(p).toMatch(/never write a free-text question/i); // the server owns the Hebrew templates
  });
});

describe("createParser", () => {
  it("returns the validated events and passes today's date to the model", async () => {
    const rawParse = vi.fn(
      async (_system: string, _text: string): Promise<unknown> => validMessage,
    );
    const parse = createParser(rawParse);
    const result = await parse("אסיפת הורים מחר ב-18:30 בגן רימון", "2026-06-20");
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({ kind: "event", date_iso: "2026-06-21", time: "18:30" });
    const [system] = rawParse.mock.calls[0]!;
    expect(system).toContain("2026-06-20");
  });

  it("threads the sender name into the system prompt (#14)", async () => {
    const rawParse = vi.fn(async (_s: string, _t: string): Promise<unknown> => validMessage);
    await createParser(rawParse)("יש לי פיזיותרפיה מחר", "2026-06-20", "רוני");
    const [system] = rawParse.mock.calls[0]!;
    expect(system).toContain("רוני");
  });

  it("returns every event from a multi-event message", async () => {
    const multi = { events: [validEvent, { ...validEvent, title_he: "טיול שנתי", time: null }] };
    const result = await createParser(async () => multi)("...", "2026-06-20");
    expect(result).toHaveLength(2);
    expect(result![1]).toMatchObject({ title_he: "טיול שנתי" });
  });

  it("round-trips a model-emitted needs_clarification reason through the schema (#84)", async () => {
    // The gate (extract_events) acts on this downstream; here we only assert the enum survives the
    // parser's schema validation so a flagged event still reaches the handler intact.
    const flagged = { ...validEvent, needs_clarification: { reason: "missing_date" } };
    const result = await createParser(async () => ({ events: [flagged] }))("...", "2026-06-20");
    expect(result).toHaveLength(1);
    expect(result![0]!.needs_clarification).toEqual({ reason: "missing_date" });
  });

  it("returns null when the model output fails schema validation", async () => {
    const rawParse: RawParse = async () => ({ events: [{ kind: "party", title_he: "" }] });
    expect(await createParser(rawParse)("???", "2026-06-20")).toBeNull();
  });

  it("returns null when the output isn't a message object", async () => {
    const rawParse: RawParse = async () => validEvent; // bare event, not { events: [...] }
    expect(await createParser(rawParse)("???", "2026-06-20")).toBeNull();
  });

  it("returns null when the model output is null (refusal/empty)", async () => {
    const rawParse: RawParse = async () => null;
    expect(await createParser(rawParse)("???", "2026-06-20")).toBeNull();
  });

  it("returns null on a permanent (4xx) provider error — rephrase fallback, no retry", async () => {
    const rawParse = vi.fn(async () => {
      throw Object.assign(new Error("bad request"), { status: 400 });
    });
    const parse = createParser(rawParse, { sleep: () => Promise.resolve() });
    expect(await parse("???", "2026-06-20")).toBeNull();
    expect(rawParse).toHaveBeenCalledTimes(1); // permanent → not retried
  });

  it("retries a transient error then throws TransientError when it persists", async () => {
    const rawParse = vi.fn(async () => {
      throw Object.assign(new Error("overloaded"), { status: 529 });
    });
    const parse = createParser(rawParse, { retries: 1, sleep: () => Promise.resolve() });
    await expect(parse("???", "2026-06-20")).rejects.toMatchObject({ name: "TransientError" });
    expect(rawParse).toHaveBeenCalledTimes(2); // initial + one retry
  });

  it("recovers when a transient error clears on retry", async () => {
    let n = 0;
    const rawParse = vi.fn(async () => {
      n += 1;
      if (n === 1) throw Object.assign(new Error("503"), { status: 503 });
      return validMessage;
    });
    const parse = createParser(rawParse, { retries: 1, sleep: () => Promise.resolve() });
    expect(await parse("...", "2026-06-20")).toHaveLength(1);
    expect(rawParse).toHaveBeenCalledTimes(2);
  });

  it("rethrows a programming error RAW (not TransientError) and does not retry — OG10/#57", async () => {
    // A TypeError from rawParse is statusless, so isTransient would call it transient and the
    // parser would wrap it as TransientError → the inbound row stays `pending` → boot-replays
    // forever. The isProgrammingError guard rethrows it raw so processInbound markFailed-settles it.
    const rawParse = vi.fn(async () => {
      throw new TypeError("cannot read properties of undefined (reading 'parse')");
    });
    const parse = createParser(rawParse, { retries: 1, sleep: () => Promise.resolve() });
    await expect(parse("???", "2026-06-20")).rejects.toBeInstanceOf(TypeError);
    expect(rawParse).toHaveBeenCalledTimes(1); // programming bug → permanent → NOT retried
  });
});

describe("anthropicRawParse", () => {
  it("calls messages.parse with the configured model and returns parsed_output", async () => {
    const parse = vi.fn(async (_body: unknown) => ({ parsed_output: validMessage }));
    const client = { messages: { parse } } as unknown as Anthropic;
    const raw = anthropicRawParse(client, "claude-haiku-4-5");

    const out = await raw("system prompt", "forwarded text");

    expect(out).toEqual(validMessage);
    expect(parse).toHaveBeenCalledTimes(1);
    const body = parse.mock.calls[0]![0] as { model: string; output_config: unknown };
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config).toBeDefined(); // zodOutputFormat(schema) did not throw
  });
});
