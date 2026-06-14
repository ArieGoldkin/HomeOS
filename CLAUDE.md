# CLAUDE.md

> Fast session-start brief for HomeOS. For depth, see the pointers at the bottom — don't duplicate them here.

## What this is

HomeOS — an AI-powered, **WhatsApp-first, Hebrew family command center** for the Israeli market: a
WhatsApp bot now, a kitchen-tablet ambient display + companion app later. Forward a Hebrew message →
it becomes a structured event on the family board. Solo dev, evenings, ≤$100/mo. Foundation-first:
nothing built is thrown away.

## Status (2026-06-14)

- **M1** (echo bot — prove receive→send) ✅ merged to `main`.
- **M2** (forward → Claude parse → SQLite → Hebrew confirm) ✅ built, on **PR #1** (`feat/m2-parse-confirm`).
- **Next:** Demo 2 manual smoke, then **M2b** (voice notes via `mlx_whisper`).

## Where things live

```
platform/                 pnpm monorepo — ALL code (node_modules isolated here, repo root stays clean)
├── apps/server/          @homeos/server — WhatsApp webhook → parse → confirm
│   └── src/{http,whatsapp,parsing,db,core}/   layered by concern; index.ts + config.ts at root
└── packages/shared/      @homeos/shared — ParsedEvent contract (server produces, P1 display consumes)
docs/idea/                research, market study, architecture-roadmap-playground.html
```

## Commands (run in `platform/`)

```bash
pnpm install
pnpm test          # 51 tests — no live network or Claude calls
pnpm typecheck     # strict TypeScript
pnpm dev           # start the server (WhatsApp + Claude setup: apps/server/README.md)
```

## Stack

Node ≥22 via **tsx** (no build step) · **Hono** · **`@anthropic-ai/sdk`** (model `claude-haiku-4-5`,
swappable via `ANTHROPIC_MODEL`) · **`node:sqlite`** behind an `EventStore` interface · **zod/v4**
(shared schema) · **Vitest** · **pnpm** workspaces.

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
- **`platform/apps/server/README.md`** — run the server, Meta setup, Demo 2.
