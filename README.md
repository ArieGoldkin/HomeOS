# HomeOS

AI-powered, **WhatsApp-first, Hebrew family command center** for the Israeli market.
Form factor: kitchen-tablet ambient display + companion app + WhatsApp bot. Mission: reduce the
household "mental load" by making the management that lives in one person's head visible and shared.

> **Status:** building **M1 — the echo bot** (proving the WhatsApp receive→send loop).

## Repository layout

```
homeOS/
├── docs/idea/      # research, strategy, market validation, and the architecture roadmap
├── platform/       # all application code — pnpm monorepo (apps/ + packages/)
├── AGENTS.md       # orientation for agents/contributors
└── README.md       # you are here
```

The code is isolated under [`platform/`](platform/) so the repository root stays clean
(no build tooling or `node_modules` mixed in with research docs).

## Start here

- **Build & run the code:** [`platform/README.md`](platform/README.md) →
  [`platform/apps/server/README.md`](platform/apps/server/README.md)
- **Product & strategy:** `docs/idea/` — `market-research.md`, `assessment.md`, and the
  interactive `architecture-roadmap-playground.html`
- **Current project state:** `.claude/continuity/ledgers/CONTINUITY_homeOS.md`

## The wedge

A direct competitor (**FamilyOS**) already owns the Hebrew / WhatsApp / forward-to-ingest space —
but has **no kitchen-tablet display**. That ambient display, plus privacy-first chat scoping and
deeper Israeli localization, is HomeOS's differentiation. Everything is built foundation-first:
the M1 webhook service is the trunk that grows into the full product.
