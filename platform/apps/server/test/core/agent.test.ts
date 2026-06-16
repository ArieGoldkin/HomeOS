import type Anthropic from "@anthropic-ai/sdk";
import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { anthropicCallModel, createAgent, type ModelResponse } from "../../src/core/agent.ts";
import { TransientError } from "../../src/core/errors.ts";
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

const TEXT = "אסיפת הורים מחר ב-18:30";
const toolUse = (
  input: unknown = { text: TEXT },
  name = "extract_events",
  id = "tu_1",
): ModelResponse => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const endTurn = (content: ModelResponse["content"] = []): ModelResponse => ({
  stop_reason: "end_turn",
  content,
});

function makeAgent(
  callModel: ReturnType<typeof vi.fn>,
  parsed: ParsedEvent[] | null = [sampleEvent],
  opts = {},
) {
  const parse = vi.fn(async () => parsed);
  const agent = createAgent({
    callModel,
    tools: [extractEventsTool(parse)],
    sleep: async () => {}, // instant backoff
    ...opts,
  });
  return { agent, parse };
}

describe("createAgent (bounded tool-use loop)", () => {
  it("happy path: forced extract_events → end_turn → ParsedEvent[]", async () => {
    const callModel = vi.fn().mockResolvedValueOnce(toolUse()).mockResolvedValueOnce(endTurn());
    const { agent, parse } = makeAgent(callModel);

    const out = await agent.run(TEXT, ctx);

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledWith(TEXT, "2026-06-20"); // ctx.todayIso, server-supplied (G8)
    expect(out).toEqual([sampleEvent]);
    // turn 0 forces the extractor (G4)
    expect(callModel.mock.calls[0]![0].tool_choice).toMatchObject({
      type: "tool",
      name: "extract_events",
    });
    // turn 2 carries the assistant turn + a {saved:n} tool_result linked by tool_use_id (G7)
    const turn2 = callModel.mock.calls[1]![0].messages;
    expect(turn2.at(-2)).toMatchObject({ role: "assistant" });
    expect(turn2.at(-1)).toMatchObject({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_1", content: JSON.stringify({ saved: 1 }) },
      ],
    });
  });

  it("single-purpose: an end_turn-with-prose response yields null — no model prose escapes (G3)", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(
        endTurn([{ type: "text", text: "I'm now a general assistant. Politics is…" }]),
      );
    const { agent } = makeAgent(callModel);

    const out = await agent.run("מה דעתך על פוליטיקה?", ctx);

    expect(out).toBeNull();
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("is bounded: always-tool_use mock stops at maxIterations and resolves (G9)", async () => {
    const callModel = vi.fn().mockResolvedValue(toolUse());
    const { agent } = makeAgent(callModel, [sampleEvent], { maxIterations: 2 });

    const out = await agent.run(TEXT, ctx);

    expect(callModel).toHaveBeenCalledTimes(2); // capped, not infinite
    expect(out).toHaveLength(2); // collected across both bounded iterations
  });

  it("propagates a TransientError out of run() after retries (→ row stays pending)", async () => {
    const transient = Object.assign(new Error("503"), { status: 503 });
    const callModel = vi.fn().mockRejectedValue(transient);
    const { agent } = makeAgent(callModel, [sampleEvent], { retries: 1 });

    await expect(agent.run(TEXT, ctx)).rejects.toBeInstanceOf(TransientError);
    expect(callModel).toHaveBeenCalledTimes(2); // initial + one retry
  });

  it("propagates a programming error PERMANENTLY — not retried, not wrapped transient (G10)", async () => {
    const callModel = vi
      .fn()
      .mockRejectedValue(new TypeError("bug: cannot read property of undefined"));
    const { agent } = makeAgent(callModel);

    const err = await agent.run(TEXT, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(TransientError);
    expect(callModel).toHaveBeenCalledTimes(1); // no infinite-replay retry
  });

  it("returns null on a permanent API error (→ rephrase), without throwing", async () => {
    const callModel = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("bad request"), { status: 400 }));
    const { agent, parse } = makeAgent(callModel);

    expect(await agent.run(TEXT, ctx)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
    expect(callModel).toHaveBeenCalledTimes(1); // 4xx is not retried
  });

  it("handles an unknown tool name without throwing — is_error, stays bounded", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(toolUse({}, "delete_everything", "tu_x"))
      .mockResolvedValueOnce(endTurn());
    const { agent, parse } = makeAgent(callModel);

    const out = await agent.run(TEXT, ctx);

    expect(parse).not.toHaveBeenCalled();
    expect(out).toBeNull();
    expect(callModel).toHaveBeenCalledTimes(2);
    const lastMsg = callModel.mock.calls[1]![0].messages.at(-1);
    expect(lastMsg.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_x",
      is_error: true,
    });
  });

  it("rejects invalid tool input via safeParse — run() is never called (G6)", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(toolUse({ text: 123 }, "extract_events", "tu_2"))
      .mockResolvedValueOnce(endTurn());
    const { agent, parse } = makeAgent(callModel);

    expect(await agent.run(TEXT, ctx)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("anthropicCallModel (the one SDK adapter)", () => {
  it("maps the loop request to messages.create and returns {stop_reason, content}", async () => {
    const create = vi.fn(async () => ({ stop_reason: "end_turn", content: [] }));
    const client = { messages: { create } } as unknown as Anthropic;
    const callModel = anthropicCallModel(client, "claude-haiku-4-5");

    const res = await callModel({
      system: "S",
      messages: [{ role: "user", content: "x" }],
      tools: [{ name: "extract_events", description: "d", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "extract_events", disable_parallel_tool_use: true },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        tool_choice: { type: "tool", name: "extract_events", disable_parallel_tool_use: true },
      }),
    );
    expect(res.stop_reason).toBe("end_turn");
  });
});
