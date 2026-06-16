<!-- Generated 2026-06-16 by the agent-core-design workflow (10 agents): research(5/6) → synthesize →
adversarial critique (over-engineering + security) → finalize. The security-prompt-injection RESEARCH
agent failed on a transient API 500; its ground was recovered by the security CRITIQUE lens, which read
the real code and produced the two BLOCKERS in §4 (G1, G2). Source issues: #13 (+ #14 in §10). -->

# Agent Core (#13) — Design & Build Plan

## 1. Decision summary

- **What:** Replace the single `parse()` call in `handler.ts` with `agent.run(text, ctx)` — a thin, **bounded, single-purpose** tool-use loop over `client.messages.create` (NOT the beta `toolRunner`), driven by a flat `tools/` array whose only member today is `extract_events`, which reuses `parser.ts` verbatim. **Why:** it satisfies #13's "tool-using agent with a declarative tool registry" while keeping the proven `(text, todayIso) → ParsedEvent[] | null` contract, so the queue, allowlist, ביטול undo, and test net are untouched.
- **The one tool re-runs `parser.ts`** (a second structured-output Claude call inside the tool), accepting ~2× calls/message. This preserves parser.ts's retry/validation/`TransientError` seam — foundation-first, trivially inside ≤$100/mo.
- **Right-sized, not gold-plated** (over-engineering critique): `maxIterations` defaults to **2** (forced `extract_events` turn + wrap-up), not 4; collapse to **2 new source files** (`tools.ts`, `agent.ts`) instead of 5 — no separate `registry.ts`/`types.ts`/`agent-prompt.ts` indirection until a second tool/prompt-surface exists.
- **Security is mechanical, not prompt-prayer** (security critique, two BLOCKERS): the structured channel **is** a prose channel — so we **content-bound the contract** (`title_he.max(80)`, etc., strip control chars) and **cap input length before any model call**. These are the load-bearing single-purpose/cost defenses; the prompt delimiter is the weakest, layered last.
- **#14 rides the identical path** with zero new tools and zero new code path — it is just untrusted text whose first-person → assignee resolves from server-supplied `ctx.from`.

## 2. Architecture — the bounded tool-use loop

The outer pipe is **byte-identical** to today. Only `handler.ts:109` changes.

```
webhook ──200──▶ enqueue (idempotent on wa_message_id) ──▶ processInbound ──▶ handleInbound
                                                                                   │
   ┌───────────────────────────────────────────────────────────────────────────────┘
   ▼  (order is LOAD-BEARING — security critique: ביטול must precede any model call)
 (1) allowlist gate ─not allowed▶ REFUSAL_HE, return
 (2) text-only guard ─no text▶ TEXT_ONLY_HE, return
 (3) ביטול undo ─"ביטול"▶ deleteLastFromSender, confirm, return   ← never sent to Claude
 (4) INPUT-LENGTH CAP ─ text.length > MAX_INPUT▶ REPHRASE_HE, return  ← NEW, pre-model (security)
 (5) parsed = await deps.agent.run(text, { todayIso, from, waMessageId })   ← the ONE changed line
 (6) !parsed || length===0 ▶ REPHRASE_HE ; else saved = parsed.map(saveEvent under seq) ; formatConfirm
       │  TransientError thrown out of run() ─uncaught▶ handler catch ▶ TRANSIENT_HE + rethrow ▶ row stays pending
```

`agent.run` — the bounded loop inside `core/agent.ts`:

```
run(text, ctx):
  messages = [ user: `Forwarded message to process:\n<forwarded>\n${text}\n</forwarded>` ]
  collected = []
  for i in 0 .. maxIterations-1:            # default 2, NEVER while(true)
    tool_choice = i===0 ? {type:'tool', name:'extract_events', disable_parallel_tool_use:true}
                        : {type:'auto',  disable_parallel_tool_use:true}
    res = callModel({ model, max_tokens, system, tools, messages, tool_choice })   # transient-wrapped
    switch res.stop_reason:                 # EXHAUSTIVE (security MAJOR — pause_turn handled)
      'tool_use'              -> run tools, append results, continue
      'end_turn'|'stop_sequence' -> return collected   # NEVER res text
      default (refusal | max_tokens | pause_turn | …) -> return collected.length ? collected : null
  return collected.length ? collected : null            # cap hit: degrade, NEVER throw
```

```
 callModel (the only seam that touches the real SDK)
   client.messages.create(...) → retry on isTransient (injected sleep) → else throw TransientError
   programming errors (TypeError/RangeError) → rethrow as PERMANENT (security MINOR: no infinite replay)

 dispatch (inline in agent.ts, not a separate registry layer)
   find tool by name → if none: tool_result {is_error:true}     # bounded, never throws
   inputSchema.safeParse(rawInput)  → if !ok: tool_result {is_error:true}   # re-validate untrusted args
   tool.run(parsed, ctx) → collect events → tool_result content = JSON.stringify({saved:n})  # COUNT, never echoed text
```

**Happy path = exactly 2 model calls** (forced `extract_events` → `end_turn`). `extract_events` is a pure leaf returning a count ack, so there is no feedback the model can act on — iteration 2+ exists only as a structural guard, not advertised ReAct machinery (over-engineering critique). The loop is written N-tool-safe (iterate all `tool_use` blocks, all results in one user message, append the **full** assistant content) because that costs one `.filter` + `for` the loop already needs — but `maxIterations=2` and we do not ship cap-degradation logic as a tested deliverable beyond the one bounded test.

## 3. Tool registry — the `Tool` type + how tools attach

A single `tools.ts` module exporting the `Tool` shape, `ToolContext`, and `extractEventsTool`. The "registry" is the **flat array passed to `createAgent`** — appending to it is the declarative attach point. No separate `registry.ts` (over-engineering critique).

```ts
// platform/apps/server/src/tools/tools.ts
import { z } from "zod/v4";
import type { ParseMessage } from "../parsing/parser.ts";
import type { ParsedEvent } from "@homeos/shared";

/** Server-supplied, NEVER model-supplied. Closes the date-spoof / sender-impersonation surface
 *  (security) and is the #14 first-person→assignee source. */
export interface ToolContext {
  todayIso: string;     // Asia/Jerusalem anchor
  from: string;         // sender phone (→ assignee in #14)
  waMessageId: string;
}

/** Declarative seam: append a Tool to the array to register it. */
export interface Tool<I = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;            // re-validated against untrusted model output
  run(input: I, ctx: ToolContext): Promise<{ events: ParsedEvent[] }>;
}

const MAX_TOOL_TEXT = 8000;             // defense-in-depth; authoritative cap is pre-model in handler

/** The only tool for #13. Reuses parser.ts verbatim — still produces ParsedEvent[]. */
export function extractEventsTool(parse: ParseMessage): Tool<{ text: string }> {
  return {
    name: "extract_events",
    description:
      "Extract calendar items (events/tasks/reminders) from the forwarded family message text.",
    inputSchema: z.object({ text: z.string().min(1).max(MAX_TOOL_TEXT) }),
    async run({ text }, ctx) {
      const events = await parse(text, ctx.todayIso);   // 2nd structured-output Claude call
      return { events: events ?? [] };                  // empty list = "nothing to schedule"
    },
  };
}
```

The agent emits Anthropic tool specs from this array via `z.toJSONSchema(tool.inputSchema)` at construction time. **No sort-for-stable-bytes** (over-engineering MINOR — prompt-caching is a documented no-op at ~500 tokens, below Haiku 4.5's 4096-token cache minimum; revisit only if the prefix grows past it).

## 4. Guardrails (06/2026) — each as an enforceable mechanism

| # | Guardrail | Mechanism (enforcement layer) | Source |
|---|---|---|---|
| G1 | **Content-bound the contract — the structured channel IS a prose channel** | In `packages/shared/src/index.ts`: `title_he.max(80)`, `location.max(120)`, `assignee.max(40)`, `source_text.max(2000)`; strip control chars / collapse newlines in `title_he` (see **G15** for the RTL-specific codepoints). `parsedMessageSchema.safeParse` (already in parser.ts) rejects an abusive value → `null` → REPHRASE, so a 4000-char essay / phishing link / embedded Hebrew instruction **cannot** round-trip to the user's WhatsApp via `formatConfirm`. **Schema-layer test** asserts over-length/newline `title_he` → null, not a confirm. | **security BLOCKER #1** |
| G2 | **Input-length cap before any model call (cost/DoS)** | `handler.ts` short-circuits to REPHRASE_HE when `text.length > MAX_INPUT` (e.g. 4000–8000 chars) **before** `agent.run`. Authoritative cap on the original `text`; the `extract_events.inputSchema.max()` is defense-in-depth on the model-echoed copy. A 50–100KB newsletter is never sent to Claude `~2×maxIterations` times. | **security BLOCKER #2** |
| G3 | **Single-purpose — structured-only return** | `agent.run` returns `ParsedEvent[] \| null` assembled from `extract_events` output; **never** the model's text turn. `handler.ts` builds the confirm from `ParsedEvent[]`. Test: `end_turn`-with-prose → `null`. (G1 is what makes it *true* — prose inside a valid `tool_use` is caught by G1, not G3.) | security + design |
| G4 | **Single-purpose — forced `tool_choice` turn 0** | `i===0` uses `{type:'tool', name:'extract_events', disable_parallel_tool_use:true}` — model is mechanically forbidden a free-text-only first turn; "nothing to schedule" is an empty `events` list, never a free-text refusal. | design |
| G5 | **Exhaustive `stop_reason` switch** | Handles `tool_use`/`end_turn`/`stop_sequence` explicitly; **every other** value (`refusal`, `max_tokens`, `pause_turn`, future) → safe `return collected-or-null` via `default`. A `const _exhaustive: never = stop_reason` makes a future SDK value a compile error, not a silent hang. | **security MAJOR** |
| G6 | **Re-validate every tool input** | Inline dispatch runs `inputSchema.safeParse(rawInput)` (typed `unknown`) before `run`. Forced `tool_choice` guarantees the tool is *called*, not that args are well-formed; invalid/oversized → `is_error` tool_result, loop stays bounded. | security + design |
| G7 | **tool_result is a structured ack, never echoed untrusted text** | `tool_result` content is `JSON.stringify({ saved: n })` (a count) — enforced invariant. `tools.ts` documents that any future read-only feedback tool must bound/strip strings it feeds back (on `i>0` the model is in `tool_choice:auto`, so a malicious result string is a fresh action-capable injection). Registry test asserts no field of the forwarded text reflects into tool_result. | **security MAJOR** |
| G8 | **Anchor data server-supplied** | `todayIso` + `from` live in `ToolContext`, passed by `handler.ts` from `msg`, never tool-input fields — forwarded text can't spoof the Jerusalem date or impersonate a family member. | security + design |
| G9 | **Bounded loop** | Hard `for (i < maxIterations)`, **default 2**, never `while(true)`. Cap-hit returns collected-or-null, never throws, never poisons the queue row. Test: always-`tool_use` mock → exactly `maxIterations` calls, resolves. | security + design |
| G10 | **Transient-vs-permanent preserved; programming bugs don't infinite-replay** | `callModel` treats errors as transient **only** for actual provider errors (`Anthropic.APIError` with transient status / known network code); `TypeError`/`RangeError` propagate as **permanent** → `markFailed`, not pending. `TransientError` bubbles uncaught out of `run()` → handler catch → row stays pending → boot-replay. | **security MINOR** + design |
| G11 | **Order is load-bearing** | allowlist → text-only → ביטול → input-cap → agent. ביטול before the agent so the undo word is never sent to Claude; allowlist first so non-family senders are never processed. Asserted by existing handler tests. | security + design |
| G12 | **One read-only tool this PR** | `extract_events` is the only tool; no side-effecting tool lands in #13. When Phase-5 adds a destructive tool (e.g. `remove_event`), gate confirmation **inside that tool's `run`** (explicit confirm token), mirroring ביטול. | design |
| G13 | **Unforgeable data delimiter** *(deferred — see §9)* | Forged `</forwarded>` weakens only the *weakest* layer (G1/G3/G4 are the mechanical backstops). Cheap hardening: per-message nonce tag or strip the delimiter token from `text`. Optional hardening, not a blocker. | security MINOR |
| G14 | **No live calls in tests** | `agent.run` depends on an injected `callModel`/client seam; tests pass `vi.fn` returning canned `{stop_reason, content}` sequences with `sleep` stubbed to no-op. In-memory SQLite only. | design |
| G15 | **Bidi/RTL-control sanitization (Hebrew-first-class variant of G1)** | In the `title_he` (and `location`/`assignee`) `.transform()`, strip Unicode bidirectional-control codepoints `U+202A–U+202E` and `U+2066–U+2069` plus zero-widths `U+200B/U+200F`, **not just** ASCII `[\x00-\x1F]`. In an RTL product these overrides let a forwarded message render a spoofed/garbled confirm or hide a payload — generic control-char stripping misses them. Target: `packages/shared/src/index.ts` (`title_he` def). Test: a `‮`-laden `title_he` is sanitized or rejected, never confirmed. | **security re-pass (G15)** |
| G16 | **Per-sender daily message ceiling (the last unbounded cost axis)** *(fast-follow — see §9)* | The allowlist bounds *who* and G2 bounds *message size*, but nothing bounds *rate* — an allowlisted-but-abusive device can drive aggregate spend past ≤$100/mo. Mechanism: a per-sender daily count checked in `handler.ts` right after the allowlist gate, backed by a `countSince`-style query in `inbound-store.ts`, returning a quiet cap reply. Promoted from a §9 note to a numbered guardrail so it isn't lost. | **security re-pass (G16)** |

## 5. Model & cost — Haiku vs Sonnet, caching, the knob

- **Keep `claude-haiku-4-5` for both the loop and the extractor.** Tool selection is binary with one tool, so Haiku's multi-tool-planning weakness doesn't bite; it supports strict tool schemas and forced `tool_choice`. A Sonnet router ~3–5×'s input price, adds latency, and splits the model-scoped cache prefix for **zero measured accuracy need** here.
- **Never hardcode a model id in `agent.ts`** — read `config.anthropicModel` and pass it down, exactly as `anthropicRawParse` already does. The `ANTHROPIC_MODEL` env knob continues to swap both surfaces. (No `ANTHROPIC_ROUTER_MODEL` now; add later only if a real multi-tool plan needs a stronger planner.)
- **Cost:** happy path ≈ 2 Claude calls/message (loop `messages.create` + parser's `messages.parse`) ≈ **$0.004–0.006/msg ≈ $6–9/mo at 50/day** — trivially inside ≤$100/mo. G2's input cap is what keeps an adversarial long message from breaking this.
- **Prompt-caching is a no-op today and we add no `cache_control` machinery.** System + one tool schema ≈ 400–600 tokens, **below Haiku 4.5's 4096-token cache minimum**, so caches silently won't fire (`cache_read_input_tokens: 0`). Log `res.usage.cache_read/creation` on first deploy; only add caching when the prefix grows past 4096 — and if so, keep `todayIso` **out** of any cached block (it's a per-day silent invalidator) and in the message turn.
- `max_tokens: 2048` on the loop call (matches parser.ts), non-streaming — well under SDK timeout.

## 6. File plan

| Path | Change | Purpose |
|---|---|---|
| `platform/apps/server/src/tools/tools.ts` | **new** | `Tool<I>` + `ToolContext` + `extractEventsTool(parse)`. The flat array IS the declarative registry. Reuses `parser.ts`'s `ParseMessage` unchanged. (Collapses the design's `types.ts`+`registry.ts`+`extract-events.ts` into one file — over-engineering critique.) |
| `platform/apps/server/src/core/agent.ts` | **new** | `createAgent({ client, model, tools, system, maxIterations=2 })` → `run(text, ctx): Promise<ParsedEvent[]\|null>`. Bounded `messages.create` loop; forced turn-0 `tool_choice`; **inline** tool dispatch (find→safeParse→run); transient-wrapped `callModel` with permanent-error split; **exhaustive** `stop_reason` switch; structured-only return. System prompt inlined as a `const` here. |
| `platform/apps/server/src/core/handler.ts` | **modified** | `HandlerDeps.parse → agent: Agent`; add the **pre-model input-length cap** (G2); swap `deps.parse(text, today)` → `deps.agent.run(text, { todayIso: today, from: msg.from, waMessageId: msg.id })`. Allowlist→text-only→ביטול→cap→agent order, `TransientError` catch, REPHRASE/persist/`formatConfirm` tail, and `processInbound` settle all unchanged. |
| `platform/apps/server/src/index.ts` | **modified** | Composition root: keep `anthropic` + `createParser`; add `const agent = createAgent({ client: anthropic, model: config.anthropicModel, tools: [extractEventsTool(parse)], system: AGENT_SYSTEM })`; pass `agent` instead of `parse` into deps. No new env keys. |
| `platform/packages/shared/src/index.ts` | **modified** | **Content-bound the contract (G1):** `title_he.max(80)`, `location.max(120)`, `assignee.max(40)`, `source_text.max(2000)`; control-char strip / newline-collapse transform on `title_he`. THE contract the agent re-validates. |
| `platform/apps/server/src/parsing/parser.ts` | reused (unchanged) | `createParser`/`anthropicRawParse`/`buildSystemPrompt`/`parsedMessageSchema` + retry/backoff + `TransientError` reused verbatim as the `extract_events` body. Test net stays the extraction regression guard. |
| `platform/apps/server/src/db/event-store.ts` | reused (unchanged) | `saveEvent` idempotent on `(wa_message_id, seq)`; `deleteLastFromSender` for ביטול. Persist+confirm tail untouched. |
| `platform/apps/server/src/core/errors.ts` | reused (+ tighten) | `TransientError`/`isTransient` reused. Confirm/tighten `isTransient` so non-API programming errors are **not** transient (G10). |
| `platform/apps/server/test/core/agent.test.ts` | **new** | Mocked-loop tests (§7). |
| `platform/apps/server/test/tools/tools.test.ts` | **new** | Registry/tool tests (§7). |
| `platform/apps/server/test/core/handler.test.ts` | **modified** | Swap `parse` mock → `agent` mock; existing assertions stay green; add input-cap + transient-rethrow assertions. |
| `platform/apps/server/test/integration/flow.test.ts` | **modified** | Stub at `callModel` (not `parse`), real tools+agent+handler+stores; assert full chain incl. **seq-stability across re-run** (G-seq). |

## 7. Test plan — mocked-loop, no live calls

**Product-guarantee tests (the core — lock real behavior):**
1. **Happy path:** scripted `callModel` returns turn1 `tool_use` (`extract_events`, `input:{text}`) then turn2 `end_turn`; assert `callModel` called 2×, `extract_events.run` invoked with validated input, `run()` resolves to the `ParsedEvent[]` the tool produced.
2. **Single-purpose / injection (structured-only):** `callModel` returns `end_turn` with a **text-only** content block; assert `run()` → `null` and **no model prose** returned.
3. **Transient propagation:** `callModel` rejects with a 503-shaped `Anthropic.APIError`; with injected instant `sleep`, assert it retries then throws `TransientError` out of `run()` (handler leaves row pending).
4. **G1 schema-layer (BLOCKER #1):** an over-length or newline-laden `title_he` → `parsedMessageSchema.safeParse` fails → `null`/REPHRASE, **not** a confirm. *This is the test that actually locks single-purpose.*
5. **G2 input cap (BLOCKER #2):** handler test — a `text` over `MAX_INPUT` short-circuits to REPHRASE_HE and `agent.run` is **never called**.

**Bounded/adversarial tests (justified by the security critique making the branches reachable):**
6. **Bounded loop (G9):** `callModel` always returns `tool_use`; with `maxIterations=2` assert exactly 2 calls and `run()` resolves (counter, not timer).
7. **Exhaustive stop_reason (G5):** `callModel` returns `pause_turn` (and an unknown value) → bounded termination, no hang.
8. **Permanent-error split (G10):** a `TypeError` thrown inside the loop → propagates permanent → `processInbound` `markFailed` (not infinite pending).
9. **Tool-result threading + invalid input (G6/G7):** assert turn-2 last message is a `tool_result` with matching `tool_use_id` and `{"saved":n}` content; malformed tool input → `is_error`, loop stays bounded; assert no field of the forwarded text appears in tool_result.

**Registry/tool tests (`tools.test.ts`):** `extract_events` shape; `run(validInput)` delegates to a mocked `ParseMessage`; `safeParse` rejects missing/oversized `text` (not a throw); unknown tool name → handled error; `z.toJSONSchema(inputSchema)` is a valid object-root schema with `additionalProperties:false`.

**Integration (`flow.test.ts`):** stub at `callModel`; real tools+agent+handler+stores+Hono; assert 200-ack → enqueue → `extract_events` runs → multi-event save under distinct seq → Hebrew confirm → `GET /events` → ביטול undo → dedup on duplicate `wa_message_id` → boot-replay. **Plus a seq-stability case (G-seq):** a `wa_message_id` whose `extract_events` returns a **different-ordered** list on the second run asserts **no duplicate rows**.

**Gate:** `pnpm typecheck` (strict) + `pnpm test` green; suite grows from 95 it() blocks; no network, in-memory SQLite only. One focused `callModel`-wrapper unit test asserts the request body (model from config, `tools` present, `tool_choice` forced on turn 0, `max_tokens`).

## 8. Build order — small TDD steps (red→green), each shippable

1. **Contract hardening (G1) first** — red: schema test asserting over-length/newline `title_he` → null. Green: add `.max(...)` + control-char transform in `shared`. *Shippable on its own: closes the prose/phishing channel even before the agent lands.* Full suite stays green (parser.ts re-validates).
2. **`tools.ts`** — red: `tools.test.ts` (shape, delegates to mocked `ParseMessage`, `safeParse` rejects oversized, `z.toJSONSchema` valid). Green: write `Tool`/`ToolContext`/`extractEventsTool`.
3. **`agent.ts` happy path** — red: test 1. Green: minimal loop, `maxIterations=2`, forced turn-0 `tool_choice`, inline dispatch, structured-only return.
4. **`agent.ts` single-purpose + transient** — red: tests 2 & 3. Green: structured-only return + transient-wrapped `callModel` reusing `errors.ts`.
5. **`agent.ts` bounded + exhaustive + permanent split** — red: tests 6, 7, 8. Green: `for`-bound, exhaustive `stop_reason` switch with `never` check, permanent-error classification.
6. **Tool-result threading + invalid input (G6/G7)** — red: test 9. Green: full-assistant-content append, single-user-message results, `is_error` on bad input, `{saved:n}` ack invariant.
7. **Handler swap + input cap (G2)** — red: tests 5 + rewired existing handler tests. Green: `parse→agent` dep swap, add pre-model length cap, wire `ctx`.
8. **Composition root** — `index.ts`: build `agent` from `[extractEventsTool(parse)]`, pass into deps. `pnpm dev` smoke.
9. **Integration** — red: rewrite `flow.test.ts` to stub at `callModel`, add the **seq-stability** case (G-seq). Green: wire real agent end-to-end.
10. **Gate** — `pnpm typecheck && pnpm test` green; add the focused `callModel`-wrapper request-body test.

## 9. Risks & open questions

- **G13 (forged `</forwarded>` delimiter) — deferred, not done.** G1/G3/G4 are the mechanical backstops; the delimiter only aids the model. Cheap hardening (per-message nonce tag or strip the token) recommended as a fast-follow.
- **seq-stability under a re-run (G-seq) — chosen mitigation = single-extraction invariant.** #13's agent does exactly one `extract_events` call whose ordered list is canonical; no second extraction can append. We assert this rather than switching `seq` to a content hash. Revisit if Phase-5 adds a tool that can append events (content-hash `seq` from `source_text+date_iso`).
- **Forced `tool_choice` always calls `extract_events`,** even on unschedulable messages — confirm the system prompt explicitly tells the model to return `[]` (not decline), so this never surfaces as a `refusal`. `parsedMessageSchema` already supports `[]`.
- **#14 assignee mapping is out of scope but the seam is in place.** `ctx.from` → human-readable family-member name needs a phone→name map (config or members table). #13 lands the `ToolContext.from` seam so #14 adds only the mapping, not a code path.
- **Mock-fidelity gap (residual).** Loop tests script a simplified turn via the injected seam, so they won't catch a real SDK block-shape mismatch. The one focused `callModel`-wrapper test + the integration harness mitigate; a true live-SDK contract test is precluded by the no-live-calls guardrail.
- **`maxIterations=2` headroom.** If a future read-only feedback tool needs iteration 2+, bumping the constant is a one-line, zero-risk edit at that time — we explicitly do **not** pre-pay for it now.
- **Per-sender rate ceiling — now G16 (fast-follow).** Allowlist alone doesn't bound spend; G2's input cap is the #13 mitigation. A per-sender daily message ceiling in the inbound table is the fast-follow, not built in #13.
- **Security re-pass DONE (2026-06-16).** The `security-prompt-injection` research dimension that failed on a transient 500 was independently re-run as a single agent. Verdict: **"minor additions — no blocker gap."** Every primary threat mapped to an existing guardrail; the load-bearing defense is correctly G1 (schema content-bound), not G13 (prompt). Two additions folded in: **G15** (bidi/RTL-control strip — Hebrew-specific) and **G16** (per-sender rate ceiling, promoted). The re-pass also confirmed a **latent bug**: `errors.ts` `isTransient` currently returns `true` for any error without a numeric `.status`, so a `TypeError` in the loop → infinite boot-replay — closed by **G10**.

## 10. How #14 (direct commands) lands on top — no new code path

A direct command (`"ביום שני יש לי פיזיותרפיה, תכניס ליומן"`) enters the **identical** pipe: allowlist → text-only → ביטול → input-cap → `agent.run` → `extract_events` → `ParsedEvent[]` → persist → confirm. It is just untrusted text. Two changes, both **inside the existing extractor**, neither a new tool or branch:

1. **Prompt nuance** in `extract_events`/parser system text: a first-person command (`"יש לי"`, `"תכניס ליומן"`) is a schedulable item whose `assignee` is the sender.
2. **First-person → assignee from `ctx.from`** — resolved from the **server-supplied** `ToolContext.from` (G8), never from anything the model invents. The only addition #14 needs beyond the prompt nuance is the phone→name mapping (open question above) — and the `ToolContext.from` seam for it already exists after #13.

Because the input is untrusted forwarded text either way, every §4 guardrail (G1 content-bound, G2 input-cap, G3 structured-only, G6 re-validate, G8 server-supplied anchor) applies to #14 unchanged — #14 inherits the security posture for free.
