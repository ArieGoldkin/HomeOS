# Agentic Assistant — design (Phase 4c)

> Status: **DESIGNED** (2026-06-21). Milestone **#11**; issues **#147** (P1, active), **#148/#149** (icebox).
> Supersedes the deterministic Hebrew-regex routing for cancel/edit. Evolves Agent Core (#2) + Conversational (#8).
> Reactivates the deferred `homeos-personal-agent-vision` (MVP-first, bounded).

## Problem

The deterministic router is brittle. Three layers decide a cancel — a Hebrew **regex** (intent), a **SQL token-match over `title_he`** (which event), and a **model** that parsed the same words into title-vs-location differently than the user references them. They can't agree:

- `טוב בטל את הפגישה מחר עם יונתן` → a leading filler defeated the `^`-anchored cancel route → parsed as a **new** event (fixed in PR #146).
- `אסיפת הורים בגן רימון` → `רימון` is in the **location**, but resolution matches **title only** → 0 matches → "לא מצאתי" (the remaining gap this milestone closes).

No amount of regex/tokenizer tuning fixes this — it's the wrong architecture.

## Decision (user, 2026-06-21)

Pivot to a **bounded-agentic assistant**: the model is the brain (intent + entity resolution), grafted onto the existing tool-use loop. Three locked choices:

1. **Family-domain only, fully agentic** — agentic in *how* it reasons, bounded in *what* it's about. Declines off-topic. Keeps us inside Meta's 2026 single-purpose AI-bot policy (#30, the +972 ToS risk).
2. **Confirm-before-destroy** — the model *proposes* a cancel/edit; the user *confirms*; the **handler executes** the DB write (preserves the G20/G22 safety intent without the regex).
3. **Templated replies for now** — the model drives *tools + resolution*, not chat. The handler renders Hebrew from structured tool results (preserves G3/G5 + anti-injection). Model-composed prose is a later, separate opt-in.

## What stays vs. changes

| Layer | Decision |
|---|---|
| Allowlist · input cap (G2) · sanitize (G15) · rate (G16) · HMAC | **STAY** — mechanical security, untouched. |
| User-facing replies | **STAY TEMPLATED** (handler renders from structured results — G3/G5). |
| Destructive DB writes (`deleteById`, `updateEvent`, calendar mirror) | **STAY IN THE HANDLER** — model proposes, user confirms, handler executes. |
| Intent + entity resolution | **MOVE TO THE MODEL** (incrementally; see phasing). |
| Hebrew reference regexes (`extractCancelRef`, `extractEditDelta`) | **RETIRE** in P2, after dogfooding — not before. |

## Phase 1 design (the one coherent path)

Reconciled from the planning workflow (`wjbnull4m`), whose four research agents proposed **three contradictory** resolution designs; the adversarial critics caught it. The resolved, minimal design:

- **Broader resolution (the fix):** a read-only `search_events` over **title + location + assignee** (board rows only, `source_provider IS NULL`, family-scoped, bounded LIMIT), reusing `likeArg`/`hintLikeGroups`/`rowToSaved`. **`findEventsByRef` is left untouched** — it stays the strict AND-over-title matcher guarding the deterministic destructive path (#125/G22).
- **Deterministic fast-path stays primary:** `CANCEL_REF_RE`/`EDIT_REF_RE` → `findEventsByRef` unchanged (0 model calls; existing tests green). On a **0-match for a specific reference**, fall through to a **bounded agent run** forced to the resolve tool (**never** the `extract_events` default — agent.ts:171/184 — or a cancel creates a junk event) that emits `cancel_event{id}` / `edit_event{id,patch}` via a structured **confirm arm** (mirror the `{clarify}` side-channel; ids only, never prose — G7/G17). Fits `maxIterations=2`.
- **Confirm-before-destroy gate:** the 1-match arm (deterministic AND agent) opens a confirm thread *"לבטל את X? כן/לא"* instead of auto-deleting; reuse the **existing** `ConversationStore` single-candidate thread + a **fail-closed** `AFFIRM_RE` (anchored `כן` → execute; anything else → abort). Reusing the existing kinds avoids a SQLite `CHECK` migration. The write stays in `cancelOne`/`applyPatchToId`.

### Closed tool set (we decide; elaborated later)
`search_events` (new, read-only) · `add_events` (= today's `extract_events`) · `cancel_event` / `edit_event` (propose → confirm) · `sync_calendar` / `sync_gmail` (existing).

### Guardrails
G3/G5 · G7/G17 · G20/G22 · Meta single-purpose. #55 (G13 unforgeable delimiter) lands as a **defense-in-depth sibling** — the model now sees command text, but the write is still gated by search + explicit confirm, so it is not a hard blocker.

## Phasing (incremental — NOW vs LATER)

- **NOW: #87** — finish the conversational hardening (TTL-as-config, boot-sweep ordering, single-use, `flow.test.ts`). It's the foundation the confirm gate reuses; closes Milestone #8. The live bug is already de-fanged by #146 (no junk events, no data risk), so the foundation goes first.
- **NEXT: #147 (P1)** — broader-field resolve + model fallback + confirm gate. Fixes the location/assignee resolution agentically.
- **LATER (icebox):** **#148 (P2)** retire the reference regexes (post-dogfood) · **#149 (P3)** read-only Q&A + conversation memory (deferred, opt-in).

## Milestone map

| Item | Placement |
|---|---|
| #11 Phase 4c · Agentic Assistant | new milestone |
| #147 P1 (active) · #148 P2 (icebox) · #149 P3 (icebox) | → #11 |
| #87 conversational hardening | stays in #8 — **prerequisite**, land first |
| #55 G13 delimiter | stays in Phase 4 (#2) — **P1 sibling**, defense-in-depth |

## Cost & risk
- Agentic = 1–2 model calls only on the **hard miss** (deterministic path stays 0-call for the common case) — bounded by `maxIterations` + the G16 daily cap. ≤$100/mo holds.
- #30 (+972 AI-ToS): templated replies + off-topic decline keep us closer to "ancillary scheduling tool" than "primary AI." Residual platform risk, already tracked.

## Provenance
8-agent + 6-agent planning workflows (`wf_cfe9b84e-743`). The adversarial critics rejected the first draft (contradictory resolution designs; would not have fixed the reported bug); this doc is the corrected, minimal synthesis.
