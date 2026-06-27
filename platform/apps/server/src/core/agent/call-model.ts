import type Anthropic from "@anthropic-ai/sdk";
import type { CallModel, ResponseBlock } from "./types.ts";

/**
 * Production `CallModel`: the ONLY seam that touches the real SDK block shapes. Maps the loop's
 * minimal request/response to `client.messages.create`. Kept tiny so the SDK coupling (and its
 * version churn) lives in one place with one focused test.
 */
export function anthropicCallModel(client: Anthropic, model: string, maxTokens = 2048): CallModel {
  return async (req) => {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // Deterministic decoding, in parity with the parse path (parser.ts anthropicRawParse). The agent
      // only ever emits structured tool calls (no prose, by design), so creative sampling buys nothing
      // and only adds variance to WHICH tool fires and the titleHint/text args it extracts — temp 0
      // makes tool selection + resolve-term extraction reproducible and tightens eval stability.
      temperature: 0,
      system: req.system,
      messages: req.messages as Anthropic.MessageParam[],
      tools: req.tools as unknown as Anthropic.Tool[],
      tool_choice: req.tool_choice as Anthropic.ToolChoice,
    });
    return { stop_reason: res.stop_reason, content: res.content as unknown as ResponseBlock[] };
  };
}
