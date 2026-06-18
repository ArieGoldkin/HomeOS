# Gmail Ingestion (#17) — Design Plan

> Model-driven Gmail ingestion: a WhatsApp command ("סנכרן מייל") makes the agent call a
> new read-only `read_gmail` tool that reuses the existing parse path and tags derived
> events with `source_provider:"google"` for #61's disconnect-purge.
> Foundation-first, opt-in, read-only, TDD/strict-TS, ≤$100/mo.

Status: **proposed** · Depends on: #59 (OAuth client), #60 (routes/config), #61 (provider purge) · Tier: **SIGNIFICANT** (new module, but grafted onto existing seams)

---

## 1. Problem & the core contract wrinkle

We want: forward nothing — instead a family member sends a Hebrew command in WhatsApp
("סנכרן מייל" = "sync mail"), the agent calls a new tool that reads recent matching Gmail
messages, runs each through the **existing** parser, and saves the resulting events to the
board — already done by the proven WhatsApp path.

The wrinkle is in the persistence contract. Today:

```
agent.run(text, ctx): Promise<ParsedEvent[] | null>   // a FLAT array — the loop's `collected`
        │
        ▼
handler:  parsed.map((event, seq) =>
            events.saveEvent(event, { fromPhone: msg.from, waMessageId: msg.id, seq }))
```

`saveEvent` is idempotent on `UNIQUE(wa_message_id, seq)` and writes `source_provider`
(default `null`). **The provenance fields — `waMessageId`, `seq`, `source_provider` — are
assigned by the _handler_, not the tool.** The tool only returns `{ events: ParsedEvent[] }`;
the agent loop flattens every tool's events into one `collected` array and loses which tool
(and which source) produced each event.

Gmail ingestion breaks two assumptions of that path:

1. **Idempotency.** Re-running "סנכרן מייל" must not duplicate events. The natural idempotency
   key is the **stable Gmail message id** (AC4), not `(waMessageId, seq)` of the command —
   every command has a *new* `waMessageId`, so the current key would re-insert everything.
2. **Provenance.** Gmail-derived rows must carry `source_provider:"google"` so #61's
   `deleteByProvider("google")` purges them on disconnect (AC: disconnect-purge). The WhatsApp
   path hard-codes `source_provider` to `null` (it's not even passed).

So the contract must let a tool own its rows' identity (idempotency key) and provenance,
instead of having the handler stamp one `waMessageId`+`seq` over everything.

### Resolution: tools return *saved* events, not raw events (handler stops persisting)

Move persistence **into the tool layer** and change the agent/handler contract from
"tool returns events, handler saves them" to **"tool persists its own events and returns what
it saved."** This is the smallest change that fixes both problems at the seam, and it is
strictly foundation-first — the WhatsApp extractor moves its one `saveEvent` line down by one
layer; behaviour is unchanged.

New tool contract (`tools/tools.ts`):

```ts
// before: run(input, ctx): Promise<{ events: ParsedEvent[] }>
// after:
run(input: I, ctx: ToolContext): Promise<{ saved: SavedEvent[] }>;
```

`ToolContext` gains the two seams a persisting tool needs (both deferred-reserved already):

```ts
export interface ToolContext {
  todayIso: string;
  from: string;
  waMessageId: string;
  senderName?: string;
  familyId: string;                       // for getValidAccessToken (today: "default")
  events: EventStore;                     // tools persist through this
  google?: GmailToolDeps;                 // the reserved ctx.google seam (#60, design §6)
}
```

- **`extract_events`** (WhatsApp) now persists with the *exact same* key it has today:
  `saveEvent(event, { fromPhone: ctx.from, waMessageId: ctx.waMessageId, seq })`,
  `source_provider` left `null`. No behaviour change — the line just lives in the tool now.
- **`read_gmail`** persists with a **Gmail-derived synthetic key** and the provider tag:
  `saveEvent(event, { fromPhone: ctx.from, waMessageId: \`gmail:${gmailMessageId}\`, seq, sourceProvider: "google" })`.

The agent loop's `collected` becomes `SavedEvent[]`; `agent.run` returns `SavedEvent[] | null`;
the handler drops its `.map(saveEvent)` and just confirms `formatConfirm(saved)`.

#### Why the synthetic `wa_message_id = "gmail:<id>"` (and not a new column / table)

- The events table already has `UNIQUE(wa_message_id, seq)` and an idempotent upsert. Reusing
  it for Gmail means **zero schema change for idempotency** — re-running the command upserts the
  same `("gmail:<id>", seq)` rows as no-ops (AC4 satisfied by the existing seam). Gmail message
  ids are globally stable and never collide with WhatsApp `wamid.*` ids, so the namespace is
  clean with a `gmail:` prefix.
- `source_provider:"google"` is set independently (not derived from the prefix) so #61's
  `deleteByProvider("google")` is the authoritative purge — the prefix is just the idempotency
  namespace, the column is the provenance.
- A multi-event email keeps per-event `seq` (0..n), same as a multi-event forward.

This keeps the change a **handler-thin / tool-fat** refactor: one DB-touching line moves from
the handler into each tool, plus a new tool. No new persistence concept, no new table, no new
unique index.

---

## 2. Guardrails (this feature must honour all of them)

| Guardrail | Source | How Gmail ingestion honours it |
|---|---|---|
| **🔒 Allowlist** (G1) | `core/allowlist.ts`, handler | Unchanged — the command arrives as a normal inbound WhatsApp message and passes the same allowlist gate before the agent ever runs. Gmail content is never an entry point. |
| **🚫 Single-purpose** (G1/policy) | `AGENT_SYSTEM` | The new tool only *extracts calendar items from the family's own mail*. No chat, no open-domain. System prompt extended to name the second capability explicitly. |
| **Input cap** (G2) | handler `MAX_INPUT=4000` | The *command* is tiny. The *email bodies* are capped inside the tool (per-message body slice ≤ `MAX_TOOL_TEXT`/parser cap) **and** bounded by `maxMessages` (e.g. 10) — the cost ceiling, see §6. |
| **Forced first turn** (G4) | `agent.ts` `tool_choice` turn 0 | Turn 0 still forces `extract_events`. **Decision (§5):** command-routing is done by a deterministic pre-agent check in the handler (a `סנכרן מייל` trigger like the `ביטול` undo), NOT by relaxing G4. This keeps the agent's forced-tool invariant intact and avoids a model round-trip just to route. |
| **Tool input re-validation** (G6) | `agent.ts` `safeParse` | `read_gmail`'s `inputSchema` (zod) is re-validated. The model supplies **no** secrets and **no** identifiers — only optional, bounded filter hints (label/sender), all server-clamped. |
| **Tool result is a count, never echoed text** (G7) | `agent.ts` dispatch | Tool result block stays `{ saved: n }`. Email bodies never re-enter the model loop as instructions (prompt-injection containment — same posture as `<forwarded>` data). |
| **Server-supplied context** (G8) | `tools.ts` ToolContext | `familyId`, `from`, the access token, and the Gmail query are all **server-side**. The model cannot pick a family, a token, or an arbitrary Gmail search — only nudge label/sender within an allowlisted set. |
| **Programming vs transient** (G10) | `core/errors.ts` | The Gmail client reuses `errors.ts`: 5xx/429/network → `TransientError` (row stays `pending`, boot-replays); 4xx → permanent (degrade, no replay-loop). `getValidAccessToken` already classifies auth errors this way. |
| **Per-sender daily ceiling** (G16) | handler | The command counts as one inbound message against the sender's daily ceiling, *and* the tool's own `maxMessages` bounds per-run model calls. Two independent cost bounds. |
| **Opt-in / app-only = zero calls** (AC) | `getValidAccessToken` | If the family has no credential row, `getValidAccessToken` returns `not_connected` with **zero network calls**; the tool replies "not connected, connect at …" and makes **no Gmail call and no parse call**. App-only families are completely untouched. |
| **Read-only** (AC) | scopes + client | Only `gmail.readonly` (already in `GOOGLE_SCOPES`). The client implements `list` + `get` only — no modify/send/delete endpoints exist in the code. |
| **Secret-scanner-aware** | repo scanner | Follow `oauth.ts` style: build request fields from `[name, value]` tuples, never object literals with secret-looking keys; the bearer token is injected from `getValidAccessToken`, never logged. |

---

## 3. Architecture

```
WhatsApp: "סנכרן מייל"
   │  (normal inbound — allowlist G1, ceiling G16, persist-before-ack)
   ▼
handler.handleInbound
   │  deterministic command check (like `ביטול`): text === SYNC_MAIL_TRIGGER?
   ├── no  ─────────────► existing agent.run path (forward → extract_events)
   └── yes ─────────────► agent.run(SYNC_INTENT, ctx)   // ctx.google wired
                                │  turn 0 still forces a tool (G4)
                                ▼
                          read_gmail tool.run(input, ctx)
                                │
                 1. getValidAccessToken(ctx.familyId, ctx.google)   // #59 seam
                 │     ├── not_connected → return { saved: [] }, reply "connect first"   (ZERO Gmail/parse calls)
                 │     └── ok: token
                 2. gmailClient.list(token, query)   // labels/sender, maxMessages cap
                 3. for each msg (≤ maxMessages):
                 │     gmailClient.get(token, id) → {id, subject, bodyText}
                 │     events = parse(bodyText, ctx.todayIso, ctx.senderName)   // REUSE parser.ts
                 │     for (event, seq) of events:
                 │        ctx.events.saveEvent(event, {
                 │           fromPhone: ctx.from,
                 │           waMessageId: `gmail:${id}`,    // idempotency namespace (AC4)
                 │           seq,
                 │           sourceProvider: "google",      // #61 purge tag
                 │        })
                 4. return { saved }   // SavedEvent[]
                                ▼
                          agent returns SavedEvent[] | null
                                ▼
                          handler: formatConfirm(saved)  → Hebrew confirm
```

Disconnect (existing, #61): `POST /disconnect/google` → revoke at Google → delete credential →
`events.deleteByProvider("google")` purges every `gmail:`-derived row. No new wiring needed —
the design *activates* the seam that's already built.

### New module: `google/gmail.ts` (lean `node:fetch`, house pattern — no `googleapis`)

Mirrors `oauth.ts` exactly: a hand-rolled client, injected `fetchImpl`, `errors.ts`
classification, `now()` not needed (no token math here — the token is handed in).

```ts
export interface GmailMessageRef { id: string; threadId: string; }
export interface GmailMessage { id: string; subject: string; bodyText: string; }

export interface GmailClient {
  // q is server-built (label:/from: filters); maxResults clamps cost.
  list(token: string, q: string, maxResults: number): Promise<GmailMessageRef[]>;
  get(token: string, id: string): Promise<GmailMessage>;
}

export function httpGmailClient(fetchImpl?: typeof fetch): GmailClient;
```

- `list` → `GET /gmail/v1/users/me/messages?q=<q>&maxResults=<n>` (Bearer token).
- `get` → `GET /gmail/v1/users/me/messages/<id>?format=full`, then decode the `text/plain`
  part (or strip the `text/html` part) from base64url into `bodyText`, take the `Subject`
  header. Body is sliced to the parser's cap before parse (G2 spirit).
- Errors: 401/403 → permanent `GoogleOAuthError`-style (token problem → caller degrades);
  429/5xx/network → `TransientError`; reuse the `postForm`/error-classify shape from `oauth.ts`.

### New tool: `read_gmail` in `tools/tools.ts`

```ts
export function readGmailTool(parse: ParseMessage): Tool<{ label?: string; fromSender?: string }> {
  return {
    name: "read_gmail",
    description: "Read the family's recent matching emails and extract calendar items from them.",
    inputSchema: z.object({
      label: z.string().max(64).optional(),
      fromSender: z.string().max(128).optional(),
    }),
    async run(input, ctx) {
      if (!ctx.google) return { saved: [] };                 // app-only build / not wired
      const tok = await getValidAccessToken(ctx.familyId, ctx.google);
      if (tok.status !== "ok") return { saved: [] };          // not connected → ZERO Gmail/parse
      const q = buildGmailQuery(input, ctx.google.allowedQuery); // server-clamped (G8)
      const refs = await ctx.google.client.list(tok.token, q, ctx.google.maxMessages);
      const saved: SavedEvent[] = [];
      for (const ref of refs) {
        const msg = await ctx.google.client.get(tok.token, ref.id);
        const events = await parse(msg.bodyText.slice(0, MAX_TOOL_TEXT), ctx.todayIso, ctx.senderName);
        (events ?? []).forEach((e, seq) =>
          saved.push(ctx.events.saveEvent(e, {
            fromPhone: ctx.from, waMessageId: `gmail:${ref.id}`, seq, sourceProvider: "google",
          })),
        );
      }
      return { saved };
    },
  };
}
```

### Data flow / state

| Concern | Mechanism |
|---|---|
| Idempotency (AC4) | `UNIQUE(wa_message_id, seq)` with `wa_message_id = "gmail:<gmailId>"`. Re-run = no-op upsert. **No schema change.** |
| Provenance (#61) | `source_provider = "google"` on every Gmail row. `deleteByProvider("google")` already exists. |
| Opt-in / zero-call | `getValidAccessToken` short-circuits app-only (no row) with zero network; tool returns early before any Gmail or parse call. |
| Cost (≤$100/mo) | `maxMessages` cap per run (config, default 10) × per-email parse; plus per-sender daily ceiling (G16) on the *command*. Bounded on both axes. |
| Token lifecycle | Entirely owned by `getValidAccessToken` (refresh-on-demand, self-heal on `invalid_grant`). The tool never touches the credential store directly. |

---

## 4. Error handling (reuses `errors.ts` classification verbatim)

| Situation | Behaviour | Why |
|---|---|---|
| Family not connected (no credential) | Tool returns `{ saved: [] }`; handler replies "not connected — connect at /connect/google". **Zero** Gmail/parse calls. | Opt-in AC; degrade-never-throw. |
| Credential revoked (`invalid_grant`) | `getValidAccessToken` self-heals (deletes cred → `not_connected`), tool returns empty, friendly "reconnect" reply. | Already implemented in #59. |
| Gmail 429 / 5xx / network blip | `TransientError` propagates → agent → handler leaves the inbound row `pending` → boot-replay retries. NOT marked failed. | Same posture as the WhatsApp parse path; a blip must replay, not vanish. |
| Gmail 401/403 (token rejected mid-run) | Permanent → degrade, partial `saved` is still returned/confirmed (idempotent, so re-run completes the rest). | No replay-loop on a permanent error (G10). |
| Email body unparseable / empty | `parse` returns `null` → that email contributes 0 events; the run continues. | One bad email doesn't poison the batch (G9 spirit). |
| Programming bug (TypeError, …) | Rethrown as permanent (G10) → row `failed`, visible, never replayed. | `errors.ts` `isProgrammingError`. |

---

## 5. Key decisions (resolved)

1. **Routing: deterministic handler check, not model routing.** A bare/leading `סנכרן מייל`
   trigger is caught in the handler (sibling to the `ביטול` undo) and routes to a Gmail-intent
   agent run. *Rejected alternative:* let the model choose `read_gmail` from free text — that
   would relax G4's forced-first-turn invariant and burn a model call just to classify intent.
   Keeping it deterministic preserves G4 and is cheaper. (The tool is still invoked *through*
   the agent for a uniform contract/system-prompt, but turn 0 forces `read_gmail` for the sync
   intent the same way it forces `extract_events` for a forward.)
2. **Persistence moves into the tool layer** (contract change in §1). *Rejected alternative:*
   add a `provenance` field to the returned `{events}` and keep the handler saving — but the
   agent loop flattens all tools' events into one array, so per-event provenance can't survive
   to the handler without also threading it through the loop; persisting in the tool is simpler
   and keeps the loop provenance-agnostic.
3. **Synthetic `wa_message_id = "gmail:<id>"`** for idempotency. *Rejected alternative:* a new
   `provider_message_id` column + second unique index — more schema, more migration, no benefit
   over namespacing the existing key.
4. **Lean `node:fetch` Gmail client** (`google/gmail.ts`), no `googleapis`. Matches `oauth.ts`
   and `whatsapp/client.ts`; keeps the dependency surface and bundle tiny; testable with an
   injected `fetchImpl`.
5. **Server-clamped query (G8).** The model can pass optional `label`/`fromSender` hints, but
   the final Gmail `q` is composed server-side from a config-allowlisted set (e.g.
   `newer_than:` window + an allowed label list). The model can never issue an arbitrary search.

---

## 6. Config & cost (≤$100/mo)

New `GOOGLE_*`-adjacent settings (only relevant when Google is configured):

| Var | Default | Purpose |
|---|---|---|
| `GMAIL_MAX_MESSAGES` | `10` | Hard cap on emails fetched+parsed per sync run (cost ceiling). |
| `GMAIL_QUERY_WINDOW` | `newer_than:7d` | Server-side recency clamp baked into every query. |
| `GMAIL_ALLOWED_LABELS` | (optional) | Allowlist of label hints the model may select. |

Cost bounds: one sync = ≤ `maxMessages` parse calls (Sonnet, temp 0, ~2k max_tokens each).
The per-sender daily ceiling (G16) limits how many syncs a sender can trigger per day. Both
bound the only unbounded axis (model calls) well under budget for a single family.

---

## 7. File plan

| File | Change | LOC (est) |
|---|---|---|
| `apps/server/src/google/gmail.ts` | **new** — `GmailClient` + `httpGmailClient` (list/get, body decode, error classify) | ~120 |
| `apps/server/src/tools/tools.ts` | change `Tool.run` → `{ saved: SavedEvent[] }`; extend `ToolContext` (`familyId`, `events`, `google?`); `extract_events` now persists; add `readGmailTool` + `buildGmailQuery` | ~70 (+) |
| `apps/server/src/core/agent.ts` | `collected: SavedEvent[]`; `Agent.run` → `SavedEvent[] | null`; dispatch reads `{ saved }`; force `read_gmail` on the sync intent (turn 0) | ~25 (±) |
| `apps/server/src/core/handler.ts` | add `SYNC_MAIL_TRIGGER` route (sibling to `ביטול`); drop the `.map(saveEvent)` (tools persist now); thread `events`/`familyId`/`google` into `ToolContext`; "not connected" reply | ~30 (±) |
| `apps/server/src/config.ts` | `GMAIL_MAX_MESSAGES`, `GMAIL_QUERY_WINDOW`, `GMAIL_ALLOWED_LABELS` (only when Google bundle present) | ~10 |
| `apps/server/src/index.ts` | build `GmailToolDeps` (client + `getValidAccessToken` deps + caps) when `config.google`; register `readGmailTool(parse)` in the tools array | ~12 |
| **Tests** | `test/google/gmail.test.ts` (client, fetch mock, error classify), extend `test/tools/tools.test.ts` (read_gmail: opt-in zero-call, idempotency key, provenance tag, query clamp), extend `test/core/handler.test.ts` (sync trigger routing, not-connected reply), extend `test/core/agent.test.ts` (SavedEvent contract) | ~200 |

**No schema change** (`db/schema.ts` / `db/event-store.ts` untouched — `source_provider`,
the unique key, and `deleteByProvider` from #61 are reused as-is). This is the strongest signal
the design is foundation-first.

---

## 8. Build order — 2–3 small CI-gated sub-issues (like #16 → #57–61)

> Each PR is independently green (`pnpm test` + `pnpm typecheck`), no live network/Claude in
> tests (mock `fetchImpl`, in-memory SQLite, mock model). TDD, strict TS.

**Sub-issue A — Gmail read client (`google/gmail.ts`).**
Lean `node:fetch` `list`+`get`, base64url body decode, `errors.ts` classification
(429/5xx/network → `TransientError`, 4xx → permanent), secret-scanner-safe header build.
Fully unit-tested against a mocked `fetchImpl`. No tool, no agent wiring yet — pure, isolated,
mergeable. *(Mirrors how #59 landed the OAuth client standalone.)*

**Sub-issue B — Tool contract refactor (`tools.ts` + `agent.ts` + `handler.ts`).**
Move persistence into the tool layer: `Tool.run → { saved }`, extend `ToolContext`, `extract_events`
persists (behaviour-identical), `agent.run → SavedEvent[] | null`, handler drops its
`.map(saveEvent)`. **Zero new feature** — this is the seam change, proven by the existing
WhatsApp tests staying green. Ships before C so the Gmail tool has a contract to plug into.

**Sub-issue C — `read_gmail` tool + command routing + wiring.**
Add `readGmailTool`, `buildGmailQuery`, the `SYNC_MAIL_TRIGGER` handler route, turn-0 forcing for
the sync intent, config caps, and `index.ts` registration. Tests: opt-in zero-call,
idempotency (`gmail:<id>` upsert no-op on re-run, AC4), provenance (`deleteByProvider("google")`
purges synced rows), query clamp (G8), not-connected reply, transient → pending.

*(A and B are independent and can be built in parallel; C depends on both. If a 2-issue split is
preferred, fold A into C and keep B standalone — B is the riskiest because it touches the shared
contract, so it earns its own gate either way.)*

---

## 9. Acceptance criteria → coverage map

| AC | Covered by |
|---|---|
| Opt-in only; app-only families → zero Gmail calls | `getValidAccessToken` zero-network short-circuit + tool early-return (§3, test in C) |
| Read-only | `gmail.readonly` scope only; client has no write endpoints (§2) |
| Reuse the parse path | `read_gmail` calls the same `parse(text, todayIso, senderName)` (§3) |
| Idempotent on Gmail id (AC4) | `wa_message_id = "gmail:<id>"` over the existing unique upsert (§1, §3) |
| Scope by label/sender | server-clamped `buildGmailQuery` from model hints (§5.5, §6) |
| Activates #61 disconnect-purge | `source_provider:"google"` tag → existing `deleteByProvider` (§1, §3) |
| Single-purpose / guardrails | §2 table (G1/G2/G4/G6/G7/G8/G10/G16) |
| ≤$100/mo | `maxMessages` per run + G16 per-sender ceiling (§6) |
