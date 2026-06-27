import type Anthropic from "@anthropic-ai/sdk";
import type { SavedEvent } from "../../db/event-store/index.ts";
import type { ClarifyResult, Tool, ToolContext } from "../../tools/index.ts";

/** A faithful-but-minimal view of one model turn — what the loop reads. */
export interface ModelResponse {
  stop_reason: Anthropic.StopReason | null;
  content: ResponseBlock[];
}
export type ResponseBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string };

/** Tool spec sent to the model (JSON-Schema input), built once at construction. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: unknown;
}
export type ToolChoice =
  | { type: "tool"; name: string; disable_parallel_tool_use: true }
  | { type: "auto"; disable_parallel_tool_use: true };

export interface ModelRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  tools: ToolSpec[];
  tool_choice: ToolChoice;
}

/** The injected seam: one model round-trip. Production = `anthropicCallModel`; tests = a `vi.fn`. */
export type CallModel = (req: ModelRequest) => Promise<ModelResponse>;

/** #84: the agent's third return arm — a tool asked to clarify instead of saving. The handler opens a
 *  templated thread; the draft inside NEVER passed through the model loop (G17).
 *  #147: a FOURTH arm — `resolved` carries the board rows the resolve fallback's `search_events` matched
 *  for a cancel/edit reference. Like clarify it rides a side-channel (never re-enters the model loop, G7);
 *  the handler decides 0/1/N and opens a confirm/disambiguation thread (it executes the write, never the
 *  model). An empty array means "found nothing" → the handler replies not-found. */
export type AgentResult =
  | SavedEvent[]
  | { clarify: ClarifyResult }
  | { resolved: SavedEvent[] }
  | null;

export interface Agent {
  /**
   * The rows the tools persisted, a `{ clarify }` request (#84), or `null` (→ "please rephrase"). The
   * handler confirms saved rows, asks the templated question on clarify, or rephrases on null.
   * `opts.forceTool` sets which tool turn 0 forces (default `extract_events` for a forward; the
   * handler passes `read_gmail` for the `סנכרן מייל` sync intent) — G4's forced-first-turn stays intact.
   */
  run(text: string, ctx: ToolContext, opts?: { forceTool?: string }): Promise<AgentResult>;
}

export interface AgentConfig {
  callModel: CallModel;
  tools: Tool[];
  /** Single-purpose + anti-injection system prompt. Defaults to AGENT_SYSTEM. */
  system?: string;
  /** Hard loop bound — never `while(true)`. Default 2 (forced extract turn + wrap-up). */
  maxIterations?: number;
  /** Transient retries per model call (default 1 → up to 2 attempts). */
  retries?: number;
  /** Injectable backoff (tests pass an instant no-op). */
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  /**
   * #55/G13 — source of the per-message nonce that makes the <forwarded-…> delimiter UNFORGEABLE: a
   * forwarded message can't contain a literal closing tag matching an unguessable random boundary, so it
   * can't break out of the third-party DATA region. Default: 8 random bytes (hex). Tests inject a stub.
   */
  nonce?: () => string;
}
