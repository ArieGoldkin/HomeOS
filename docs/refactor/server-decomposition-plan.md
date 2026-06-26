# Server decomposition plan (>230 LOC audit)

> Generated 2026-06-26 via `/etk:auto-research` (8 parallel architecture agents). **Analysis only — no code changed.** Scope: `platform/apps/server/src`. Threshold: ~230 LOC as a *trigger to consider* decomposition (judgment applies — not every file over the line should split). LOC counted via `wc -l` (raw lines incl. comments/blanks — which is why several "leave-as-is" calls hinge on "the length is comments") on `origin/main@f371236`; re-derive after each split lands.

## TL;DR

12 of 37 source files are >230 LOC. Of those: **8 are worth splitting now** (P0–P2), **1 splits-by-cohesion but defers** (`schema.ts`, P3), and **3 are leave-as-is** (`config.ts`, `index.ts`, `http/server.ts` — the last with only a cheap `http/auth.ts` cycle-break extracted). The audit also surfaced **1 real bug** (an import cycle) worth fixing regardless of size.

| File | LOC | Verdict | Priority | Risk | Effort | `components/`? |
|------|----:|---------|:--------:|:----:|:------:|:---:|
| `core/handler/shared.ts` | 434 | **SPLIT** → `shared/` | **P0** | low | M | no |
| `tools/tools.ts` | 528 | **SPLIT** → `tools/` | **P1** | low | M | no |
| `db/event-store.ts` | 424 | **SPLIT-BY-COHESION** → `event-store/` | **P1** | low-med | M | no |
| `core/handler/cancel.ts` | 383 | **SPLIT** → `cancel/` | **P1** | med | M | no |
| `http/server.ts` | 236 | **LEAVE** — but extract `http/auth.ts` (breaks a cycle) | **P1**\* | low | S | no |
| `core/handler/edit.ts` | 267 | **SPLIT** → `edit/` | **P2** | low | S | no |
| `core/handler/inbound.ts` | 404 | **SPLIT-BY-COHESION** → `inbound/` | **P2** | **med** | M | **yes** |
| `core/agent.ts` | 303 | **SPLIT (light)** → `agent/` | **P2** | low | S | no |
| `http/oauth-routes.ts` | 296 | **SPLIT-BY-COHESION** → `oauth-routes/` | **P2** | low | S | no |
| `db/schema.ts` | 352 | **SPLIT-BY-COHESION** — defer (opportunistic) | **P3** | low-med | M | no |
| `config.ts` | 309 | **LEAVE-AS-IS** | — | — | — | no |
| `index.ts` | 241 | **LEAVE-AS-IS** (composition root) | — | — | — | n/a |

\* the *light* `http/auth.ts` extraction is the P1 win; the full `http/server/` folder split is **not** recommended.

## Cross-cutting findings (read before any split)

1. **Server tests are NOT co-located.** They live in a parallel `platform/apps/server/test/` tree and import almost entirely through public barrels. So the "co-locate `*.test.ts`" rule is a *web-app* convention — **source splits here move zero test files**; they only repoint import paths. (Keep the parallel `test/` tree.)
2. **Explicit `.ts` extensions + NodeNext → no directory-index resolution.** Moving `foo.ts` → `foo/index.ts` forces **every importer** to repoint `./foo.ts` → `./foo/index.ts`. This is the main cost of each split (mechanical, sed-able). Per file: a **zero-churn alternative** is to leave `foo.ts` as a one-line `export * from "./foo/index.ts"` shim — but that means two barrels and deviates from the existing `core/handler/index.ts` convention. **Recommendation: move to `foo/index.ts` + repoint** (consistency), accept the import churn.
3. **🐛 Real bug — `http/server.ts` ↔ `http/oauth-routes.ts` import cycle.** `oauth-routes.ts` imports `bearerMatches` from `server.ts`; `server.ts` imports `registerOAuthRoutes` from `oauth-routes.ts`. It only works because both uses are deferred to call time. **Extract `bearerMatches` → `http/auth.ts`** and the cycle disappears. This is a genuine architectural win independent of LOC — do it as part of P1.
4. **Several *test* files are themselves over threshold** — `test/db/event-store.test.ts` (670), `test/core/handler/cancel.test.ts` (661), `test/tools/tools.test.ts` (658). A separate **test-hygiene follow-up**: split each to mirror its new source folder. Not forced by the source split.
5. **`components/` almost never applies on the server.** The web rule — `components/` only for "one dominant barrel entry + ≥2 internal non-exported atoms" — is failed by every server candidate **except `inbound/`** (one entry `handleInbound`/`processInbound` over ≥2 internal phase-atoms). The rest are flat libraries or peer-export groups → plain `foo/` folders, no `components/`.

## Recommended sequencing

**P0 — do first (de-risks everything after it):**
- `core/handler/shared.ts` → `shared/` (a pure, behavior-free extraction of the 434-LOC grab-bag). Doing it first means cancel/edit/inbound land on granular modules instead of being moved *and then* having their `./shared.ts` imports rewritten — one churn pass, not two.

**P1 — the high-value, low-risk wins:**
- `tools/tools.ts` → `tools/` (biggest file, cleanest fracture, low risk).
- `db/event-store.ts` → `event-store/` (or the lower-risk floor: extract only the 3 pure modules).
- `http/auth.ts` extraction (cheap; **breaks the import cycle** — finding #3).
- `core/handler/cancel.ts` → `cancel/` (meatiest behavioral handler file).

**P2 — after the import surface is stable:**
- `core/handler/edit.ts` → `edit/` (mirrors `cancel/`; imports its new barrel, so do it after cancel).
- `core/handler/inbound.ts` → `inbound/` **last** — the one genuinely risky move (G22 load-bearing order, ~13 early-return points, the #229 `rdeps`/single-clock invariants).
- `core/agent.ts` → `agent/` (light; extract `types`/`prompts`/`call-model`, leave the loop).
- `http/oauth-routes.ts` → `oauth-routes/` (do opportunistically when #226 next touches the callback).

**P3 / defer:**
- `db/schema.ts` → `schema/` — qualifies (domain seams map 1:1 to the stores) but it's a logic-free declarations file; the navigability win is modest against a ~25-site repoint. Split the next time it's edited to add a table, not as standalone churn.
- Test-file splits (event-store/cancel/tools `.test.ts`).

**Leave as-is:** `config.ts` (cohesive env contract; size is comments; the scanner-exempt token tricks are safest interleaved) · `index.ts` (composition root — linearity is the value; no importer ⇒ no barrel to justify; boot order is load-bearing).

---

## Per-file plans

### P0 — `core/handler/shared.ts` (434) → `shared/`
Flat folder behind a re-export `shared/index.ts` (re-exports everything currently public — siblings + `cancel.test.ts`/`binding.test.ts` deep-import it; `handler/index.ts` re-exports `HandlerDeps`/`ProcessDeps` from here):
- `shared/deps.ts` (~95) — `HandlerDeps`, `ProcessDeps`, **`familyOf`** (the #229 chokepoint reader stays with the contract it reads).
- `shared/messages.ts` (~75) — all static Hebrew strings + trigger/intent consts + `CLARIFY_QUESTIONS` + `MAX_INPUT`.
- `shared/patterns.ts` (~70) — command/extraction regexes + `stripLeadingFiller` (internal `CANCEL_VERBS`, `LEADING_FILLER_RE`).
- `shared/confirm.ts` (~30) — `AFFIRM_RE`, `NEGATION_RE`, `isAffirmative` (the fail-closed destroy gate; unit-tested directly).
- `shared/dates.ts` (~70) — `jerusalemToday`, `addDaysIso`, `weekdayOfIso`, `HEBREW_WEEKDAYS`, `WEEKDAY_RE`, `hasScheduleSignal`, `CONVERSATION_TTL_MS`, `conversationExpiresAt`.
- `shared/format.ts` (~70) — `formatWhen`/`formatConfirm`/`formatAlready`/`cancelReply`/`cancelConfirmPrompt`/`editConfirmPrompt`/`bulkCancelConfirmPrompt` (internal `hebrewDate`).
- `shared/agent-result.ts` (~45) — `clarifyOf`/`savedOf`/`resolvedOf`/`resolveCandidates`/`safeJsonParse`.
- **Caveat:** `familyOf` (#229 fallback) and `isAffirmative`/`AFFIRM_RE`/`NEGATION_RE` (destructive-confirm gate) move byte-for-byte; `resolveCandidates` must keep threading `familyOf(deps)` (don't silently swap back to `FAMILY_ID`).

### P1 — `tools/tools.ts` (528) → `tools/`
- `tools/context.ts` (~120) — the leaf type layer: `Tool`, `ToolResult`, `ClarifyResult`, **`ToolContext`** (the G8 server-supplied-context contract — move the doc-comments verbatim, they are the spec), `GmailToolDeps`, `CalendarToolDeps`. Imports from no tool module (no cycle).
- `tools/extract.ts` (~85) — `extractEventsTool` + `CLARIFY_REQUIRED_REASONS` + `MAX_TOOL_TEXT`.
- `tools/search.ts` (~30) — `searchEventsTool`.
- `tools/gmail.ts` (~65) — `readGmailTool` + `buildGmailQuery` (imports `MAX_TOOL_TEXT` from `./extract.ts`).
- `tools/calendar-read.ts` (~110) — `readCalendarTool` + `mapCalendarEvent` + internal `cleanLine` + the `MAX_*`/`CALENDAR_INPUT` consts.
- `tools/calendar-push.ts` (~125) — `mapToCalendarWrite` + `pushSavedEventsToCalendar` + `deleteFromCalendar` + `RRULE_BYDAY`/`JERUSALEM_TZ`.
- `tools/index.ts` — barrel re-exporting the full surface: types `ToolContext`/`Tool`/`ToolResult`/`ClarifyResult`/`GmailToolDeps`/`CalendarToolDeps`; fns `extractEventsTool`/`searchEventsTool`/`readGmailTool`/`readCalendarTool`/`buildGmailQuery`/`mapCalendarEvent`/`mapToCalendarWrite`/`pushSavedEventsToCalendar`/`deleteFromCalendar` (the last three are public only because `tools.test.ts` exercises them — keep them exported).
- **Caveat:** `ToolContext` is imported by `core/agent.ts` + `handler/{sync,shared}.ts` — it must land in the leaf `context.ts` with no back-edges. Repoints ~16 src/test importers.

### P1 — `db/event-store.ts` (424) → `event-store/`
Factory threads the single `db` handle + prepared statements into helper modules (no module-level connection, no cycle):
- `event-store/types.ts` (~115) — `SavedEvent`, `EventPatch`, `EventMeta`, the `EventStore` interface, `BULK_CANCEL_MAX` (re-exported — `conversation-store.ts` imports it).
- `event-store/mapping.ts` (~50) — `deriveSource`, `rowToSaved` (pure).
- `event-store/hint-match.ts` (~30) — `HINT_STOPWORDS`, `likeArg`, `hintLikeGroups` (pure; the LIKE-escaping unit — carries the "frozen — broadening here widens the destructive fast path #125/G22" warning).
- `event-store/statements.ts` (~80) — `prepareStatements(db)` + `findByRefBase`.
- `event-store/queries.ts` (~110) — `createQueryMethods(db, stmts)` (read methods; the 3 dynamic matchers do `db.prepare(sql)` per call).
- `event-store/mutations.ts` (~80) — `createMutationMethods(db, stmts)` (write/destructive).
- `event-store/index.ts` (~55) — `createEventStore(dbPath)` wiring it all.
- **Lower-risk floor:** extract only `types.ts` + `mapping.ts` + `hint-match.ts`, leave statements + methods in `index.ts` (~250). Still isolates the pure/security pieces.
- **Caveat:** keep `findEventsByRef`'s strict title-only SQL assembly in `queries.ts` (never leak `searchEvents`' 3-column clause into the shared helper); preserve the reserved `familyId` params (post-#229 the caller passes a resolved family; stores still ignore it); idempotency SQL (`ON CONFLICT(wa_message_id, seq)`) moves verbatim.

### P1 — `http/auth.ts` (new) — extract `bearerMatches`
Move `bearerMatches` (timing-safe bearer guard) from `server.ts` to a flat `http/auth.ts`; `oauth-routes.ts` imports it from there. **Breaks the `server ↔ oauth-routes` cycle.** Keep the length-check-before-`timingSafeEqual` guard and the empty-`Bearer `-token footgun note.

### P1 — `core/handler/cancel.ts` (383) → `cancel/`
Flat folder:
- `cancel/extract.ts` (~75) — `stripDateTime` (internal), `extractCancelRef`, `extractBulkCancel`.
- `cancel/selection.ts` (~25) — `parseSelection` (shared with edit — keep byte-identical).
- `cancel/delete.ts` (~45) — `cancelOne`, `cancelMany`.
- `cancel/resume.ts` (~55) — `resumeCancel`.
- `cancel/route.ts` (~65) — `routeCancelByRef`, `routeBulkCancel`.
- `cancel/threads.ts` (~70) — `openBulkCancelConfirm`/`openCancelConfirm`/`openCancelDisambiguation`.
- **Barrel** re-exports the public trio (`extractCancelRef`/`extractBulkCancel`/`parseSelection` → handler barrel) + sibling-consumed `routeCancelByRef`/`resumeCancel`/`cancelOne`. `edit/` imports `extractCancelRef`+`parseSelection` from `cancel/index.ts` (cross-folder via barrel).
- **Caveat:** frozen `findEventsByRef`/`findEventsInScope`; keep the G22 "specific-ref before touching the board" guard + the deterministic-then-agentic order; `confirmAll` reuses the `cancel` thread kind (no migration).

### P2 — `core/handler/edit.ts` (267) → `edit/`
Mirrors `cancel/`: `edit/extract.ts` (`extractEditDelta`), `edit/apply.ts` (`applyPatchToId`/`applyPatchToMany`/`applyEdit`), `edit/route.ts` (`routeEditByRef`), `edit/resume.ts` (`resumeEdit`), `edit/threads.ts` (`openEditConfirm`/`openEditDisambiguation`). Do **after** `cancel/` (imports its barrel). Keep the synced-row refusal (`source_provider !== null` → `EDIT_SYNCED_HE`) + board-only `updateEvent`.

### P2 — `core/handler/inbound.ts` (404) → `inbound/` (**the one `components/` case**)
- `inbound/inbound.ts` (root, ~115) — `handleInbound` (thin ordered spine) + `processInbound`.
- `inbound/components/binding.ts` (~30) — `tryBindPhone` (#228 pre-allowlist).
- `inbound/components/gates.ts` (~60) — `resolveFamilyOrSkip` (#229) + `enforceRateCeiling` (G16/G23).
- `inbound/components/resume-routing.ts` (~50) — `routeOpenThread`.
- `inbound/components/sync-triggers.ts` (~50) — `trySyncTriggers` (Gmail/Calendar ToolContext build).
- `inbound/components/parse-and-confirm.ts` (~70) — `runParseAndConfirm`.
- `inbound/index.ts` — barrel (`handleInbound`, `processInbound`).
- **Risk: med — do last.** ORDER IS LOAD-BEARING (G22); `handleInbound` returns early at ~13 points → each extracted helper signals "handled → return `InboundOutcome`" vs "fall through" via a sentinel/`undefined` union. The #229 `rdeps` clone + single-clock/single-`getPending` (#87/F4) invariants are shared across phases — thread them carefully.

### P2 — `core/agent.ts` (303) → `agent/`
- `agent/types.ts` (~75) — the contract types (`ModelResponse`/`ResponseBlock`/`ToolSpec`/`ToolChoice`/`ModelRequest`/`CallModel`/`AgentResult`/`Agent`/`AgentConfig`).
- `agent/prompts.ts` (~20) — `AGENT_SYSTEM`, `RESOLVE_SYSTEM`.
- `agent/call-model.ts` (~25) — `anthropicCallModel` (the isolated SDK seam; keep `temperature: 0`).
- `agent/loop.ts` (~165) — `createAgent` + inner `modelCall`/`dispatch` (keeps every G3/G4/G7/G9/G13/G17 invariant co-resident).
- `agent/index.ts` — barrel (`createAgent`, `anthropicCallModel`, `AGENT_SYSTEM`/`RESOLVE_SYSTEM`, public types).
- **Caveat:** preserve the `temperature:0` literal + the bounded-loop turn cap (`maxIterations` default 2; never throws on bound — G9) + the `stop_reason` exhaustiveness `never` check.

### P2 — `http/oauth-routes.ts` (296) → `oauth-routes/`
- `oauth-routes/deps.ts` (~80) — `GoogleOAuthDeps` + `buildGoogleDeps` + `gateMatches`.
- `oauth-routes/pages.ts` (~70) — `PAGES` + the `CONNECT_OUTCOMES` exhaustiveness loop + `page()` + `finish()` (keep the redirect-injection guard + `Referrer-Policy`/`CSP` headers).
- `oauth-routes/index.ts` (~140) — `registerOAuthRoutes` + `performDisconnect` + `MAX_*` bounds + barrel.
- **Caveat:** keep state consume **before** `exchangeCode`; **do NOT** thread a `resolveFamilyByUser` resolver here — the `FAMILY_ID` usage is the #229-deferred path that rides #226; `assertSingleFamily` stays.

### P3 / defer — `db/schema.ts` (352) → `schema/`
Domain seams map 1:1 to the stores: `schema/events.ts`, `schema/inbound.ts`, `schema/credentials.ts` (+ key-canary + oauth_state), `schema/identity.ts` (#227 families/members/phones + #228 phone_binding + `FAMILY_ID`), `schema/conversations.ts`, `schema/index.ts` (barrel re-exporting **all** symbols verbatim). **Defer** — pure declarations, navigability win modest vs ~25-site repoint; split when next adding a table. Copy DDL byte-for-byte (a stray whitespace is a latent prod bug); keep `FAMILY_ID` barrel-exported.

### LEAVE-AS-IS — `config.ts` (309), `index.ts` (241), `http/server.ts` (236, modulo `auth.ts`)
- `config.ts` — one cohesive env contract; LOC is per-field justification comments; the scanner-exempt token-key tricks (`[kWrite]`/`kSetup`/computed `clientSecret`) are safest interleaved — scattering them invites a future literal `"WRITE_TOKEN": …` that trips the secret scanner. (If it grows, the one defensible cut is `config/google.ts`.)
- `index.ts` — composition root; linearity is the value (single greppable view of the object graph); no importer ⇒ no barrel; boot order (sweep → replay → schedules → serve) is load-bearing and side-effectful. (If it ever passes ~300, lift only the Google tool-deps block to `boot/google-deps.ts`.)
- `http/server.ts` — only 6 over; cohesive Hono builder. Do **not** fold into a `server/` folder; **do** the `http/auth.ts` extraction (P1, cycle-break). Preserve: ack-then-process (200 before `process`), distinct-token-never-alias, HMAC reads the raw body, static registered last.
