# @homeos/web — the family board

ONE responsive React app (there is no separate tablet/phone/web build). **RTL-first (Hebrew)**, with a
user **light/dark** toggle. Re-skinned onto the **"Warm Paper × Living Green"** design system: warm cream
paper surfaces, a living-green primary, and a bounded blue/violet/coral/spark accent set (see
`docs/design/DESIGN.md`). Stack: React 19 + Vite + TypeScript (strict) + Tailwind v4/shadcn tokens +
TanStack Router/Query + Vitest.

> The old no-auth kitchen-tablet surface is retired. The `/`, `/phone/*`, and `/web/*` route trees
> collapsed into this single authenticated app rooted at `/today`, served same-origin from the server.
> Tokens are family-shared and build-embedded — **not** real per-user auth (deferred).

## Routes

| Route | Screen |
|-------|--------|
| `/` | → redirects to `/today` |
| `/today` | Today board (`?date=YYYY-MM-DD`) |
| `/calendar` | Week / calendar (`?date=YYYY-MM-DD`) |
| `/people` | Household / people |
| `/connections` | Connections + the recent-ingestion feed |
| `/settings` | Settings — profile · appearance (theme) · connected services · notifications |
| `/lists` | Lists — deferred placeholder (keeps the rail item live) |
| `/welcome` | First-run onboarding — **standalone**, no shell chrome |
| `/tokens` | Dev token gallery — **standalone**, not a product surface |

Every screen is hosted by the one **`AppShell`** chrome (icon rail ≥md / bottom nav <md) except the two
standalone routes. Screens reuse the **same shared feature views**; `?date=` is a typed search param.

## Folder conventions

```
src/
├── app/shell/          the ONE responsive chrome (AppShell = icon rail ≥md / bottom nav <md) over every screen
├── features/<feature>/  one feature slice; the barrel exports the entry view(s) only
│   └── components/      internal, non-exported atoms (when the folder qualifies — see below)
├── shared/
│   ├── ui/             FLAT library of UI primitives (Button, Card, Dialog, Field, SectionLabel, …)
│   ├── board/          FLAT library of family-board atoms (EventCard, PersonAvatar, …)
│   ├── theme/          light/dark ThemeProvider — data-theme on <html>, persisted to localStorage `homeos-theme`
│   └── hooks/  lib/  api/   hooks + pure utils + the typed `GET/POST /events` + `GET /messages` client
├── dev/                dev-only views (TokensView at /tokens)
├── router.tsx  App.tsx  main.tsx
├── test/               Vitest setup + msw handlers
└── styles/globals.css  Tailwind v4 `@theme` tokens — "Warm Paper × Living Green" (warm HEX + a night/glass dark map)
```

**Rules a contributor — human or AI — follows:**

- **Barrels (`index.ts`) are the public API** of each group. Import across groups via the aliases
  `@app` / `@features` / `@shared` / `@homeos/shared` — never reach past a barrel into another group's
  internals. Atoms a barrel doesn't export are private to that folder.
- **`components/` subfolder** — a folder uses one when it has a single dominant **exported entry**
  component **plus ≥2 internal (non-exported) atoms**: the entry stays at the folder root, the atoms
  move into `components/`, so the public/internal boundary is *structural*, not just a barrel comment
  (e.g. `features/settings`). **Do NOT** add `components/` to flat atom libraries (`shared/ui`,
  `shared/board`) or single-file folders — keep those flat. Grow into the rule when a flat folder
  reaches "one entry + 2 internal atoms".
- **Tests are co-located** as `*.test.tsx` next to their source (including inside `components/`). **No
  `__tests__/` folders** — co-location is the Vitest/React idiom and keeps test↔source proximity for TDD.
- **`EventCard` takes `SavedEvent` directly** (no DTO); `kind` is encoded by form + text, never a
  colored left-border (DESIGN.md anti-slop bans). Assignee color is **runtime** (`assignee-color.ts`),
  never a token. `--wa-green` is for integrations (Connections) only — the accent is the living-green
  `--primary`. `source_text` (the original forwarded words) renders only in the authenticated app's
  event-detail drawer.

## Commands (from `platform/`)

```bash
pnpm --filter @homeos/web dev     # Vite dev server
pnpm --filter @homeos/web test    # Vitest
pnpm --filter @homeos/web build   # Vite build
pnpm typecheck                    # all packages (strict TS)
```

## Data + env

TanStack Query over `GET /events` (Bearer `VITE_HOMEOS_READ_TOKEN`); writes via `POST /events`
(Bearer `VITE_HOMEOS_WRITE_TOKEN`, falls back to the read token in dev). The Connections **recent-ingestion
feed** reads `GET /messages` with a **distinct** Bearer `VITE_HOMEOS_MESSAGES_TOKEN` (must equal the
server's `MESSAGES_TOKEN`, never aliased to the read token) — **unset ⇒ the feed is empty/disabled**, the
board still works. Point `VITE_HOMEOS_API_BASE` at a local server or the gitignored
`.develop/mock-events.mjs` (CORS-enabled; serves `/events` + `/messages`, accepts any bearer). See
`apps/web/env.example`. The server has no CORS/proxy, so split dev needs the mock or a same-origin build.
```
