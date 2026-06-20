# @homeos/web — family board UI (tablet · phone · web)

One responsive React app serving three surfaces. The imported Claude-design prototype is the visual
source of truth: OCEAN accent, Rubik, cool blue-gray, **RTL-first (Hebrew)**. Stack: React 19 + Vite +
TypeScript (strict) + Tailwind v4/shadcn tokens + TanStack Router/Query + Vitest.

## Surfaces (routes)

| Route | Surface | Shell |
|-------|---------|-------|
| `/` | kitchen tablet — ambient, night theme, no-scroll kiosk | `TabletBoard` |
| `/phone/{today,week,family,settings}` | phone companion — day theme | `PhoneShell` + bottom nav |
| `/web/{today,week,family,connections,settings}` | desktop web — day theme | `WebShell` + sidebar |

Screens reuse the **same shared feature views** across surfaces (differences are layout/density only).
`?date=YYYY-MM-DD` is a typed search param on the day/week screens.

## Folder conventions

```
src/
├── app/{phone,tablet,web}/   surface shells (the entry component + its chrome). Layout routes.
│   └── <surface>/components/  internal chrome atoms (e.g. web/components/{SidebarNav,AvatarStack})
├── features/<feature>/        one feature slice; the barrel exports the entry view(s) only
│   └── components/            internal, non-exported atoms (when the folder qualifies — see below)
├── shared/
│   ├── ui/                    FLAT library of UI primitives (Button, Modal, Field, Sheet, …)
│   ├── board/                 FLAT library of family-board atoms (EventCard, PersonAvatar, …)
│   └── hooks/  lib/  api/     hooks + pure utils + the typed `GET/POST /events` client
├── router.tsx  App.tsx  main.tsx
├── test/                      Vitest setup + msw handlers
└── styles/globals.css         Tailwind v4 + shadcn tokens (OKLCH)
```

**Rules a contributor — human or AI — follows:**

- **Barrels (`index.ts`) are the public API** of each group. Import across groups via the aliases
  `@app` / `@features` / `@shared` / `@homeos/shared` — never reach past a barrel into another group's
  internals. Atoms a barrel doesn't export are private to that folder.
- **`components/` subfolder** — a folder uses one when it has a single dominant **exported entry**
  component **plus ≥2 internal (non-exported) atoms**: the entry stays at the folder root, the atoms
  move into `components/`, so the public/internal boundary is *structural*, not just a barrel comment.
  Applied in `app/web`, `features/{family,settings,week-view}`. **Do NOT** add `components/` to flat
  atom libraries (`shared/ui`, `shared/board`), peer-export folders (`add-event`, `connections`), or
  single-file folders (`day-view`) — keep those flat. Grow into the rule when a flat folder reaches
  "one entry + 2 internal atoms" (decided objectively — see the architecture investigation).
- **Tests are co-located** as `*.test.tsx` next to their source (including inside `components/` — a test
  moves with its atom). **No `__tests__/` folders**: co-location is the Vitest/React idiom and keeps
  test↔source proximity for TDD. (Revisit only if a single directory exceeds ~15–20 test files.)
- **`EventCard` takes `SavedEvent` directly** (no DTO); `kind` is encoded by form + text, never a
  colored left-border (DESIGN.md anti-slop bans). Assignee color is **runtime** (`assignee-color.ts`),
  never a token. `--wa-green` is for integrations (Connections) only — accent is OCEAN `--primary`.

## Commands (from `platform/`)

```bash
pnpm --filter @homeos/web dev     # Vite dev server
pnpm --filter @homeos/web test    # Vitest
pnpm --filter @homeos/web build   # Vite build
pnpm typecheck                    # all packages (strict TS)
```

**Data:** TanStack Query over `GET /events` (Bearer `VITE_HOMEOS_READ_TOKEN`); writes via `POST /events`
(Bearer `VITE_HOMEOS_WRITE_TOKEN`, falls back to the read token in dev). Point `VITE_HOMEOS_API_BASE` at a
local server or the gitignored `.develop/mock-events.mjs`.
