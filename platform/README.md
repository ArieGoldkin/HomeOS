# HomeOS — code (pnpm monorepo)

All application code lives here, isolated from the repo root (docs + project meta).

```
platform/
├── apps/
│   └── server/        # @homeos/server — WhatsApp webhook service (M1 lives here)
│   └── web/           # (P1) React RTL kitchen display — not built yet
└── packages/
    └── shared/        # (M2) @homeos/shared — Event/Task schemas shared by server + web
```

**Why a monorepo:** the parsed `Event`/`Task` contract (M2) is *produced* by the server and
*consumed* by the kitchen display — one source of truth in `packages/shared`, atomic changes across
both, each app deployed independently. Nothing built in M1 is thrown away; later phases graft onto it.

## Toolchain

- **Node** ≥ 22 (developed on 24) · **pnpm** 10 workspaces · **TypeScript** strict
- **Hono** web framework · **Vitest** tests · run via **tsx** (no build step in dev)

## Commands (run from this directory)

```bash
pnpm install
pnpm test          # all workspace tests
pnpm typecheck     # strict TypeScript across the workspace
pnpm dev           # start the server (see apps/server/README.md for WhatsApp setup)
```

Per-app docs: [`apps/server/README.md`](apps/server/README.md).
