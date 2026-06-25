# CLAUDE.md

> Fast session-start brief for HomeOS. For depth, see the pointers at the bottom — don't duplicate them here.

## What this is

HomeOS — an AI-powered, **WhatsApp-first, Hebrew family command center** for the Israeli market: a
WhatsApp bot now, a kitchen-tablet ambient display + companion app later. Forward a Hebrew message →
it becomes a structured event on the family board. Solo dev, evenings, ≤$100/mo. Foundation-first:
nothing built is thrown away.

## Status (2026-06-24)

- **WhatsApp bot** ✅ live in production — forward Hebrew → Claude parse → SQLite → Hebrew confirm,
  agentic cancel/edit (confirm-before-destroy), Gmail + Google Calendar sync.
- **Web family board** ✅ — ONE responsive app (RTL Hebrew, user light/dark toggle), re-skinned onto the
  **"Warm Paper × Living Green"** design system. Milestone #12 (web redesign) retired the no-auth
  kitchen-tablet kiosk: the old `/`, `/phone/*`, `/web/*` surfaces collapsed into a single authenticated
  app rooted at `/today`, served same-origin from the server. (Tokens are NOT real per-user auth yet —
  family-shared, build-embedded; real auth is deferred.)
- **Next:** Phase 6 prioritization/dashboard MVP (#5) · self-serve "Connect Google" OAuth (#10).

## Where things live

```
platform/                 pnpm monorepo — ALL code (node_modules isolated here, repo root stays clean)
├── apps/server/          @homeos/server — WhatsApp webhook → parse → confirm; serves the web app same-origin
│   └── src/{http,whatsapp,parsing,db,core}/   layered by concern; index.ts + config.ts at root
├── apps/web/             @homeos/web — the responsive family board (React 19 · Vite · Tailwind v4 · shadcn)
│   └── src/{app,features,shared,dev}/   one barrel per group; deps flow app → features → shared
└── packages/shared/      @homeos/shared — SavedEvent/ParsedEvent contracts (server produces, web consumes)
docs/idea/                research, market study, architecture-roadmap-playground.html
docs/design/              DESIGN.md (design system) + web-architecture-plan.md (web app structure)
```

## Commands (run in `platform/`)

```bash
pnpm install
pnpm test          # full suite (shared + server + web) — no live network or Claude calls
pnpm typecheck     # strict TypeScript
pnpm dev           # start the server (WhatsApp + Claude setup: apps/server/README.md)
```

## Stack

Node ≥22 via **tsx** (no build step) · **Hono** · **`@anthropic-ai/sdk`** (model `claude-sonnet-4-6`,
swappable via `ANTHROPIC_MODEL`) · **`node:sqlite`** behind an `EventStore` interface · **zod/v4**
(shared schema) · **Vitest** · **pnpm** workspaces.
**Web** (`apps/web`): **React 19** · **Vite** · **Tailwind v4** (CSS-first `@theme`, tokens in `styles/globals.css`) ·
**shadcn/radix** · **TanStack Query/Router** — one responsive RTL app, built and served same-origin by the server.

## Conventions & guardrails (don't break these)

- **TDD, strict TS.** Keep tests green; never hit live network or Claude in tests (mock the client; in-memory SQLite).
- **Foundation-first.** New work grafts onto existing seams (`core/handler`, `whatsapp/client`, `parsing/parser`, `db/event-store`).
- **🔒 Allowlist + official WhatsApp Business API only.** Process only forwarded/allowlisted messages — never all chats (privacy red line + the only ToS-legal path).
- **🚫 Single-purpose bot** — no open-domain chat (keeps us inside Meta's 2026 AI-bot policy).
- **⚡ Ack-then-process** webhooks (return 200 first, work async); idempotent on `wa_message_id`.
- **Hebrew is first-class** — keep Hebrew strings intact; anchor dates to **Asia/Jerusalem**.
- All code under `platform/`; keep the repo root clean.

## Go deeper

- **`AGENTS.md`** — fuller orientation (market verdict, FamilyOS competitor, legal/privacy constraints).
- **`.claude/continuity/ledgers/CONTINUITY_homeOS.md`** — living state, decisions, next steps (read first when resuming).
- **`docs/idea/architecture-roadmap-playground.html`** — milestone roadmap (M1 → M2 → P1 → End Goal).
- **`docs/design/web-architecture-plan.md`** — the web app's structure (one responsive app, feature slices,
  design tokens); design-system spec in **`docs/design/DESIGN.md`**.
- **`platform/apps/server/README.md`** — run the server, Meta setup, Demo 2.
- **`platform/apps/web/README.md`** — run the web app, routes, theme + token notes.
