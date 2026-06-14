# HomeOS

AI-powered, **WhatsApp-first, Hebrew family command center** for the Israeli market.
Form: kitchen-tablet ambient display + companion app + WhatsApp bot. Mission: reduce the
"household mental load" by making the management that lives in one person's head visible and
shared.

## Status

**M1 in progress — the echo bot.** The pnpm monorepo is scaffolded under `platform/` and the
WhatsApp webhook service (`@homeos/server`) is built and tested (34 tests, strict typecheck).
Remaining for M1: the manual Meta setup + Demo 1 smoke test (see `platform/apps/server/README.md`).
Prior research/strategy phase is complete (see `docs/idea/`).

## Key Context

- **Founders:** Arie & Hodaya. Founding conversation + WhatsApp follow-up are transcribed in `docs/idea/`.
- **Market verdict:** *Qualified GO.* The "no competitor in Israel" premise is **false** — see below.
- **Direct competitor:** **FamilyOS** (Morad Stern, on base44) — Hebrew-native, WhatsApp
  forward-to-ingest, ~4K free users in ~2.5mo. **It has NO kitchen-tablet display** — that's our wedge.
- **Differentiation wedge:** (1) kitchen-tablet ambient display, (2) privacy-first chat
  scoping, (3) deeper Israeli localization (חגים, חוגים, white-shirt days), (4) a real monetization model.
- **Technical/legal gate:** Only the **official WhatsApp Business Platform API** is viable —
  it sees messages *forwarded to the bot's number* only. "Listening to all conversations"
  is impossible/ToS-violating and gets numbers banned. The forward/dedicated-chat model is
  both the privacy-safe and the only legal architecture.

## Repo Layout

- `platform/` — **all application code** (pnpm monorepo; node_modules isolated here, not at root):
  - `apps/server/` — `@homeos/server`, the WhatsApp webhook service (M1). See its README.
  - `packages/` — shared libs land here (`@homeos/shared` Event/Task schemas in M2).
  - `apps/web/` — (P1) React RTL kitchen display, not yet built.
- `docs/idea/` — research & strategy:
  - `assessment.md` — initial product assessment
  - `market-research.md` — deep-research report (sources, confidence, verdict)
  - `*.html` — interactive strategy-brief / architecture-roadmap visualizations
  - `conversation-*` / `whatsapp-*` — founding transcripts (he/en)
  - `hermes-agent-eval.md` — eval of NousResearch hermes-agent (verdict: poor fit as foundation)
- `.claude/continuity/ledgers/CONTINUITY_homeOS.md` — **the living project ledger; read this
  for current state, decisions, and next steps.** (gitignored, user-specific)

## Working Conventions

- Read `CONTINUITY_homeOS.md` first to get up to speed on current state and open decisions.
- Code work follows the foundation-first roadmap (`docs/idea/architecture-roadmap-playground.html`):
  build M1's trunk so M2/P1 graft on, never throw away. Keep changes test-driven (Vitest, strict TS).
- When citing market claims, preserve the confidence/vote/source style used in `market-research.md`.
- Hebrew is a first-class concern; keep Hebrew terms intact.
