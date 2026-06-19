<!-- Generated 2026-06-19 by the web-ui-architecture workflow (9 agents): investigate(5) → synthesize →
adversarial critique (over-engineering + design-fidelity/CSS/RTL-a11y) → finalize. Grounded in the imported
Claude-design prototype (docs/design/prototype/HomeOS-Prototype.dc.html), the ftk June-2026 skills, + web
research. Locked decisions: prototype = visual source of truth; CSS = Tailwind v4 + shadcn (user-approved
over a CSS-Modules lean, with a pivot gate after EventCard + 2 screens); one responsive app, feature-based +
shared per-group barrels. Supersedes the retired "Editorial Paper" palette/fonts in DESIGN.md. -->

# HomeOS Phase 6 — Family Board UI Architecture

> Phase 6 builds the **frontend** for HomeOS: the family "board" that shows what the WhatsApp bot
> captured. One responsive app serves three surfaces — kitchen-tablet ambient display, phone companion,
> web dashboard. Backend (Phase 1–5) is complete and live; this is greenfield `platform/apps/web/`.
> Source of truth = the imported Claude-design prototype (`docs/design/prototype/HomeOS-Prototype.dc.html`).

## 1 Decision summary

| Decision | Choice | Why |
|---|---|---|
| Visual source of truth | The imported prototype (`HomeOS-Prototype.dc.html`) | Locked this session. Tokens, motion, layout extracted FROM it; supersedes the retired "Editorial Paper" v0.1. |
| CSS approach | **Tailwind v4 + shadcn/ui** (readability-weighted) | Prototype already uses the shadcn semantic-token dialect; `globals.css` is already a v4+shadcn file; Radix stays headless (a11y is a tie); CSS Modules would mean hand-building Dialog/Sheet/Popover. |
| App shape | **One responsive app**, not three; **no `packages/ui` yet** | One developer, one runtime target. Promote to a package only when a second runtime (RN/Electron) appears. |
| Folder model | **feature-based** + **shared cross-surface building blocks**, **per-group barrels** | Explicit user ask. `app/ → features/ → shared/ → @homeos/shared`, one-directional. |
| State | TanStack Router **typed search param** (`?date=`) + `data-attribute` on `<html>` (theme/dir); **no Zustand / no global store** | Server state → TanStack Query; nav state → the router; add a store only if an unsaved-add buffer emerges. |
| Data | TanStack Query over **`GET /events`** | `{ events: SavedEvent[] }`, Bearer-gated; parsed by a new `savedEventSchema` in `@homeos/shared`. |
| Routing | **TanStack Router** (type-safe, SPA) | Chosen with TanStack Query as ONE unified stack (user opt-in); typed search params back the `?date=` selected-day state. Tablet first slice still needs **no router** — it lands at the phone shell. |
| First slice | Scaffold + tokens + `EventCard` + **TabletBoard** rendering REAL `/events` data | Tablet is the primary ambient use case, has the most distinctive layout, and zero interaction. |

**Corrections folded in from critique (these change the contract — do not skip):**

- `savedEventSchema` in the synthesis was **wrong against the live server**. The live `SavedEvent`
  (`apps/server/src/db/event-store.ts:22`) is `id: number`, `source_provider: string | null`. The
  endpoint returns **`{ events: [...] }`** (`server.ts:65`), not a bare array, and is **Bearer-gated**
  (503 when no read token, 401 without a matching `Authorization: Bearer`). `rowToSaved` **drops
  `created_at`** — it is NOT in the payload. The schema, the fetch wrapper, and the "just added" cue
  are all corrected below.
- The "stale terracotta tokens" risk is **~90% already done**: `globals.css` (Jun 19) is already
  ocean/Rubik/12px v0.2. The real leftovers are narrow: the `--who-*` CSS vars must be **deleted**,
  plus four residual "terracotta" word-references in `DESIGN.md`/`globals.css` comments. Issue #2 is a
  **polish + strip pass**, not a token rewrite.
- Assignee color is a **runtime concern**, never a CSS token: `assignee` is a free-form bounded string
  (`boundedLine(40)` in `@homeos/shared`); the prototype's `aba/ima/yoav/noa/all` `--who-*` vars are
  sample data. Map `assignee → {light, night}` hex via `shared/lib/assignee-color.ts`.

## 2 CSS approach — evaluation & recommendation

**Recommendation: Tailwind v4 + shadcn/ui.** Readability is the user's explicitly weighted axis; the
recommendation treats it as a first-class build constraint solved by **component decomposition + CVA
variants**, not by switching frameworks.

### A vs B (readability-weighted)

| Axis | A: CSS Modules + raw Radix | B: Tailwind v4 + shadcn | Winner |
|---|---|---|---|
| **Readability of caller JSX** | High — semantic class names, CSS in `.module.css` | Lower by default (class-string density); **recoverable** via `<EventCard variant="reminder" />` decomposition + CVA | **A**, but recoverable in B |
| Plumbing already done | Discarded — `globals.css` is a v4+shadcn file | Reused verbatim — copy + update values only | **B** |
| Prototype fidelity | Re-derive 349 inline styles into modules | Inline styles already use shadcn token dialect (`var(--primary)`, `var(--radius)`) | **B** |
| Dialog/Sheet/Popover/Toast | Hand-build a11y + animation yourself | `shadcn add` copies them in (Radix headless) | **B** |
| a11y | Radix headless | Radix headless | **Tie** |
| RTL | Manual logical properties | `shadcn init --rtl` generates logical properties by construction | **B** |
| Design-sync / AI-codegen | Misaligned with `/design-sync`, shadcn registry | Aligned | **B** |
| Token portability | OKLCH custom props survive | OKLCH custom props survive | **Tie** |

A wins one axis (readability). It is recoverable; the things A would cost (shadcn, the RTL transformer,
the `@theme` bridge, design-sync alignment) are **not** cheaply recoverable. This is a **low-regret**
choice: the OKLCH tokens are framework-agnostic and survive a pivot.

### Honest residual cost
shadcn's **own copied primitives** (Sheet/Dialog/Calendar internals) are dense class strings you now
own — decomposition fixes *caller* code, not vendored internals. So the density risk is mitigated, not
eliminated.

### Pivot gate (evidence-based, bounded)
After **EventCard + TabletBoard + one phone screen** are converted, do a 10-minute readability
read-through. If caller JSX still reads worse than the inline prototype despite decomposition + CVA,
that is the trigger to reconsider — make the call on 2–3 real converted components, never pre-emptively.

### Migration cost — LOW, mostly already paid
1. `docs/design/globals.css` is already v4+shadcn ocean/Rubik/12px — copy to
   `platform/apps/web/src/styles/globals.css`; **delete the `--who-*` vars**; keep `@import/@theme/@apply`.
2. Scaffold: `pnpm create vite` (react-swc-ts) → `@tailwindcss/vite` → `shadcn init --rtl`
   (`--dry-run` first) → drop `globals.css`.
3. Convert 349 inline styles → ~22 components by the prototype's SCREEN markers (identical-magnitude to
   inline→CSS-Modules — not a B-specific cost).
4. **Biome is the linter** (not Prettier): decide class-sorting at scaffold time — accept Biome nursery
   `useSortedClasses`, or add `prettier-plugin-tailwindcss` **scoped to `.tsx`** while Biome stays primary.

### Reserve `@layer components` for the 3–4 signature pieces
`paper-grain`, `draw-rule`, `now-line`, `ink/skeleton` — where real CSS reads better than utilities.

## 3 Folder architecture

```
platform/apps/web/                         # NEW @homeos/web — Vite + React 19 + strict TS
├─ index.html                              # <html dir="rtl" lang="he"> — RTL added HERE (prototype omits it)
├─ package.json                            # name @homeos/web; sideEffects:false; deps @homeos/shared workspace:*
├─ tsconfig.json                           # OVERRIDES base NodeNext → module ESNext, moduleResolution Bundler, lib [ES2022,DOM,DOM.Iterable]
├─ vite.config.ts                          # plugin-react-swc + @tailwindcss/vite + @shared/@features/@app aliases
├─ vitest.config.ts                        # jsdom, setupFiles (Testing Library + msw)
└─ src/
   ├─ main.tsx                             # entry; the ONLY import of globals.css (single side-effect)
   ├─ App.tsx                              # providers (QueryClient, theme/dir) + sets --draw-origin from dir
   ├─ router.tsx                           # route tree across the three shells (added with the phone shell)
   ├─ styles/{globals.css, fonts.css}      # OKLCH ocean tokens + 5 keyframes; @fontsource Rubik (MVP)
   ├─ shared/                              # CROSS-SURFACE building blocks (package-ready, internal for now)
   │   ├─ ui/      Button IconButton Sheet Modal SegmentedControl Field Avatar StatusDot Skeleton + index.ts
   │   ├─ board/   EventCard TimeSpine NowLine PersonChip PersonAvatar Pip RuleBar SectionHeader PeekRow
   │   │           DayRow DayColumn MemberListItem SettingsRow AddMemberButton EmptyState + index.ts
   │   ├─ lib/     cn.ts assignee-color.ts date.ts rtl.ts
   │   ├─ hooks/   use-events.ts use-clock.ts use-now.ts
   │   └─ api/     events.ts                # typed fetch over GET /events (reads .events, sends Bearer)
   ├─ features/                            # vertical slices; imported ONLY via their root index.ts
   │   ├─ day-view/  week-view/  family/  add-event/  connections/  settings/
   │   └─ onboarding/  whatsapp-ingestion/
   └─ app/                                 # THREE surface shells (layout/chrome only, NO business logic)
       ├─ tablet/   TabletShell TabletMasthead TabletFooter + index.ts   # ambient; renders DayView large; NO AddSheet
       ├─ phone/    PhoneShell PhoneBottomNav PhoneStatusBar + index.ts
       └─ web/      WebShell WebSidebar SidebarNav WebTopBar + index.ts

# Dependency rule (enforce in review): app/ → features/ → shared/ → @homeos/shared.
#   shared/ NEVER imports features/ or app/. features/ never import each other (share via shared/).

platform/packages/shared/src/index.ts      # ADD savedEventSchema (corrected: id number, source_provider nullable)
```

**Layering note (right-sized):** the atom/molecule/organism labels in §4 are **prose taxonomy for
reasoning**, not folder structure. The folder has exactly **two structural buckets**: `shared/` (behind
`@shared/ui` + `@shared/board` group barrels) and `features/` (per-feature root barrel). Per-leaf
`index.ts` is optional — use it only where a component needs its own curated sub-API; otherwise the
group barrel re-exports straight from `Component.tsx`.

### Barrel conventions (separate barrel per nested group — the explicit user ask)

1. **One `index.ts` per nested GROUP**, never a single `src/` mega-barrel. Granularities: group barrels
   (`shared/ui/index.ts`, `shared/board/index.ts`), feature-root barrels (`features/day-view/index.ts`),
   and optional leaf barrels. There is intentionally **no `src/index.ts`** re-exporting everything.
2. Re-export the **public API only** — the component + its public types/variant props. **Never
   `export *`**; never re-export internals, styles, or test utils.
3. Group barrel example — `shared/board/index.ts`:
   ```ts
   export { EventCard } from "./EventCard";
   export type { EventCardProps } from "./EventCard";
   export { TimeSpine } from "./TimeSpine";
   export { NowLine } from "./NowLine";
   export { PersonChip } from "./PersonChip";
   export { PersonAvatar } from "./PersonAvatar";
   export { SectionHeader } from "./SectionHeader";
   ```
4. Consumers import from the **group barrel**, never deep paths:
   ```ts
   import { EventCard, TimeSpine, SectionHeader } from "@shared/board";
   import { Button, Sheet } from "@shared/ui";
   import { DayView } from "@features/day-view";
   ```
5. **Cross-feature reach-in is banned** — a feature is imported only via its top `index.ts`.
6. **Tree-shake safety net:** `sideEffects:false`; `globals.css` imported only in `main.tsx`; add
   `@shared/* @features/* @app/*` aliases in **both** `tsconfig.json` and `vite.config.ts`.
7. When `packages/ui` is eventually extracted, these per-group barrels become the package's `exports`
   map verbatim.

## 4 Component inventory

`shared?` = reused across tablet+phone+web. Layer label is prose taxonomy only (see §3).

| Component | Layer | Shared? | Screens |
|---|---|---|---|
| PersonAvatar (+AvatarStack) | atom | ✅ | onboarding, tablet, phone-family, web-family, web-connections, web-sidebar |
| PersonChip (display + selectable via `selected` prop) | atom | ✅ | phone-today, web-today, add-event, web-connections |
| Pip (7–8px dot, no initial) | atom | ✅ | phone-week, web-week |
| StatusDot (presence/connection, NOT assignee) | atom | ✅ | phone-family, web-family, web-connections |
| SegmentedControl (event\|reminder\|task) | atom | ✅ | add-event |
| RuleBar (draw-rule, `--draw-origin`) | atom | ✅ | phone-today, web-today, whatsapp-ingestion |
| NowLine (1.5px primary + ltr `now · HH:MM`) | atom | ✅ | tablet, web-today |
| Field (label + input, `dir` for ltr numerals) | atom | ✅ | add-event |
| Button / IconButton (primary/ghost/dashed; 44px) | atom | ✅ | onboarding, add-event, phone-today, web-today, web-family |
| SettingsRow | atom | ✅ | phone-settings, web-settings |
| PeekRow (ltr tabular time + title) | atom | ✅ | tablet, web-today |
| SectionHeader (sentence-case eyebrow) | atom | ✅ | tablet, web-today, phone-family, phone-settings |
| AddMemberButton (dashed) | atom | ✅ | phone-family, web-family |
| Skeleton | atom | ✅ | all (loading) |
| **EventCard** (SavedEvent direct; CVA variant+density) | molecule | ✅ | phone-today, tablet, web-today, whatsapp-ingestion |
| TimeSpine (auto-1fr grid + NowLine; density prop) | molecule | ✅ | tablet, web-today |
| DayRow (phone week list row) | molecule | ❌ | phone-week |
| DayColumn (web week grid cell) | molecule | ❌ | web-week |
| MemberListItem (FamilyCard) | molecule | ✅ | phone-family, web-family |
| AddItemForm (RHF + zod vs parsedEventSchema) | molecule | ✅ | add-event |
| ConnectionCard | molecule | ❌ | web-connections |
| WhatsAppBubble (HARDCODED WA colors, pop keyframe) | molecule | ❌ | whatsapp-ingestion |
| Onboarding pieces (Step/QRConnect/InviteRow/StepDots) | molecule | ❌ | onboarding |
| Sheet (Radix Dialog → bottom sheet) | molecule | ✅ | add-event (phone) |
| Modal (Radix Dialog → centered) | molecule | ✅ | add-event (web), web-settings |
| AnytimeSidebar (tasks + tomorrow peek) | organism | ✅ | tablet, web-today |
| WeekList / WeekGrid | organism | ❌ | phone-week / web-week |
| FamilyGrid (`columns` 1\|2) | organism | ✅ | phone-family, web-family |
| SettingsList | organism | ✅ | phone-settings, web-settings |
| TabletShell / PhoneShell / WebShell | organism | ❌ | per surface |
| DayView/WeekView/FamilyView/SettingsView/Connections/Onboarding/WhatsAppIngestion | organism | ✅ | all (same view renders across surfaces; differences = shell layout + density) |

**Anti-slop regression target:** `EventCard` reminder = 8px **primary** dot + primary-colored title in
Rubik (NOT a colored left-border, NOT a serif title); task = checkbox; event = none. These are the
canonical spec — the test, not the prose doc, is the contract.

## 5 Tokens

**Locked defaults extracted from the prototype:** palette `ocean`, shape `calm` (12px), typeface
`friendly` (Rubik everywhere). `docs/design/globals.css` already carries these (v0.2, Jun 19) — keep the
`@import "tailwindcss" / @theme inline / @layer` structure; only the cleanup below remains.

**Light** (hue base `nH=225`): `--background` `oklch(0.97 0.012 225)`; `--card` `oklch(0.95 0.014 225)`;
`--secondary` `oklch(0.92 0.018 225)`; `--muted-foreground` `oklch(0.55 0.024 232)`; `--foreground`
`oklch(0.27 0.032 235)`; `--border` `oklch(0.87 0.018 225)`; `--input` `oklch(0.82 0.022 225)`;
`--primary` `oklch(0.55 0.10 228)`; `--primary-foreground` `oklch(0.98 0.01 225)`; `--shadow-paper`
`inset 0 1px 0 oklch(0.995 0.01 225)`.

**Night** (`mH=238`): `--background` `oklch(0.21 0.022 238)`; `--card` `oklch(0.245 0.024 238)`;
`--secondary` `oklch(0.27 0.026 238)`; `--foreground` `oklch(0.94 0.02 238)`; `--muted-foreground`
`oklch(0.68 0.028 238)`; `--border` `oklch(0.33 0.026 238)`; `--input` `oklch(0.37 0.028 238)`;
`--primary` `oklch(0.72 0.11 222)`; `--primary-foreground` `oklch(0.20 0.022 238)`; `--shadow-paper` none.

**Shape:** `--radius 0.75rem` (12px). Pips/avatars stay `999px`.

**Fonts:** `--font-sans "Rubik"`, `--font-display "Rubik"` (friendly default). Ship **Rubik only** for
MVP (`@fontsource-variable/rubik`, hebrew+latin subset). `--font-serif "Frank Ruhl Libre"` stays in the
token file **available** but is applied per-component only (never reassigned in `:root`); add the
font package only when a tablet-title component actually uses it. **Do not pre-install Assistant.**

**Animations:** keep all 5 keyframes verbatim in `globals.css` (not per-component — they collide):
`drawRule` (scaleX, `--draw-origin`), `settleIn` (cubic-bezier .22 .61 .36 1), `sheetUp`, `fadeIn`,
`pop`. `--dur 440ms`. Wrap in `prefers-reduced-motion` `@layer base` (0.01ms).

**Extra:** `--wa-green #3c8a52` (Connections SVG/status only, NOT `--primary`); grain `fractalNoise`
`baseFrequency 0.82` opacity .045, `mix-blend multiply` (light) / `screen` (night).

**Assignee color (CORRECTION — runtime, not a token):** `assignee` is `boundedLine(40)` (free-form),
so the prototype's `aba/ima/yoav/noa/all` keys are sample data. **Delete `--who-*` and `--who-*-wash`
from `globals.css` (both themes).** `shared/lib/assignee-color.ts` maps a string → `{light, night}` hex
from a small stable palette (deterministic hash or member-config lookup later), seeded with the
prototype's five pairs (aba `#2F7DA6/#7FB8D6`, ima `#C26A72/#E29AA0`, yoav `#2E8C7A/#6FC2B0`,
noa `#6E78C4/#A6AEE6`, all `#6b7d86/#8fa3ad`). Chip wash = `color-mix(in oklab, color 16%, transparent)`,
**with a precomputed-hex fallback field** if the tablet webview is < Chrome 111.

**WhatsApp bubble colors** (`#0b141a`, `#056452`, `#10231b`) stay **literal** in the WA components — not
tokens — so they don't break in light mode.

**DESIGN.md v0.2 polish (NOT a rewrite):** fix the 4 residual "terracotta" word-references
(component-spec Button line, reminder-pip line, now-line line; `globals.css` now-line comment); update
the reminder spec to "leading **primary** dot + primary-colored title in Rubik" and cite the EventCard
anti-slop test as canonical; record the CSS decision (Tailwind+shadcn) and the assignee-color-as-runtime
note; keep §RTL, §anti-slop, §a11y.

## 6 Stack

- **Build/runtime:** Vite 6 (`@vitejs/plugin-react-swc`) + React 19 + strict TS. **Override
  `tsconfig.base.json`** (it is `NodeNext`/`ES2022`, no DOM — wrong for a browser app): `module ESNext`,
  `moduleResolution Bundler`, `lib [ES2022, DOM, DOM.Iterable]`. Without this, `import.meta.env` and
  browser globals error.
- **CSS:** Tailwind v4 (`@tailwindcss/vite`) + shadcn/ui (Radix headless) + the OKLCH `@theme inline`
  `globals.css`.
- **Routing:** **TanStack Router** (type-safe routes + typed search params, SPA) — paired with TanStack
  Query as one unified stack; `selectedDate` becomes a validated `?date=` search param. The tablet first
  slice needs **no router** — do not install/wire it until the phone shell introduces multiple routes.
- **Data:** TanStack Query v5. `useEvents` = `useQuery(GET /events)`, `staleTime 10s`, **30s background
  refetch** for the always-on tablet. `api/events.ts` reads **`.events`** off the response
  (`z.object({ events: z.array(savedEventSchema) })`) and sends `Authorization: Bearer
  <VITE_HOMEOS_READ_TOKEN>` (the family-only read-token auth story).
- **Forms:** react-hook-form + zod resolver against `parsedEventSchema` from `@homeos/shared`.
- **Fonts:** self-hosted Rubik via `@fontsource-variable/rubik` (hebrew+latin subset, `font-display:swap`,
  no Google CDN — offline-safe tablet). Frank Ruhl added later if a component needs it.
- **Testing:** Vitest (jsdom) + `@testing-library/react` + user-event + **msw v2** mocking
  `GET /events` returning `{ events: [...] }` shape with the Bearer header path exercised. Playwright
  deferred to web-app milestone 2 (add a tablet < 3s render budget test on a throttled iPad spec).
- **Lint:** existing `platform/biome.json` (Biome 2.5, recommended preset). Verify the jsx/class-sorting
  strategy at scaffold time.
- **Monorepo/CI:** new `platform/apps/web` (`@homeos/web`), consumes `@homeos/shared workspace:*`;
  `pnpm-workspace.yaml` already globs `apps/*`. Existing `ci.yml` runs `pnpm -r --if-present
  test/typecheck/lint` and auto-picks up `@homeos/web` once it has those scripts; add
  `pnpm --filter @homeos/web build` as an initially non-blocking job.
- **Deploy:** serve the Vite build as static from the existing Hono/Railway server, or free-tier
  Cloudflare Pages — $0 additional infra. Family-only allowlist/read-token gate; no auth infra.
- **Shape:** SINGLE responsive app (one bundle) for tablet+phone+web. **NOT** three apps; **NOT** a
  `packages/ui` library yet.

## 7 RTL & Hebrew

1. **`<html dir="rtl" lang="he">`** in `index.html` (prototype deliberately omits it).
2. `shadcn init --rtl` generates primitives with logical properties (`ms-`/`me-`/`ps-`/`pe-`,
   `inset-inline-*`); the prototype **already** uses logical properties, so they port verbatim. Use
   logical properties everywhere — any `text-align:left` / `left`/`right` absolute positioning breaks.
3. **`--draw-origin`** set ONCE on `<html>` in `App.tsx`
   (`dir === "rtl" ? "right center" : "left center"`) — lives in the theme/dir init, not per-component;
   powers the RTL-aware `RuleBar` drawRule. `globals.css` already defaults it to `right center`.
4. **LTR atoms:** wrap clock, `HH:MM`, phone numbers, URLs in `<span dir="ltr">`/`<bdi>` with
   `tabular-nums`.
5. **Week grid:** render JSX in `[Sun..Sat]` order (matches `recurrenceSchema.weekday` 0=Sunday); the
   RTL grid visually places **Sunday on the right** (Israeli convention). Week starts Sunday
   (`shared/lib/date.ts`, Asia/Jerusalem). **This is the highest-risk RTL spot** (visual-only, no a11y
   signal catches a flip) — add a `WeekGrid` test asserting DOM order `[Sun..Sat]` AND a
   `getBoundingClientRect` x-order check that Sunday renders rightmost under `dir=rtl`, and verify the
   "1px gap = `--border` bg" trick survives RTL (logical gap, never left/right).
6. **Directional icons:** `rtl:rotate-180` variant.
7. **a11y:** Radix keeps ARIA/focus/keyboard correct under RTL regardless of CSS approach.

## 8 File plan

| File | Purpose |
|---|---|
| `packages/shared/src/index.ts` | `+ savedEventSchema = parsedEventSchema.extend({ id: z.number().int(), source_provider: z.string().nullable() })` + `SavedEvent` type + parse test |
| `apps/web/index.html` | `<html dir="rtl" lang="he">` |
| `apps/web/tsconfig.json` | extends base; overrides ESNext/Bundler/DOM libs; `@shared/@features/@app` paths |
| `apps/web/vite.config.ts` | plugin-react-swc + `@tailwindcss/vite` + alias resolve |
| `apps/web/src/styles/globals.css` | copy of `docs/design/globals.css`, **`--who-*` deleted**, ocean tokens + 5 keyframes |
| `apps/web/src/main.tsx` / `App.tsx` | entry (only `globals.css` import) / providers + `--draw-origin` |
| `apps/web/src/shared/lib/{cn,assignee-color,date,rtl}.ts` | utilities; assignee-color seeded + precomputed-wash fallback |
| `apps/web/src/shared/api/events.ts` | typed fetch: reads `.events`, sends Bearer |
| `apps/web/src/shared/hooks/use-events.ts` | TanStack Query, 30s refetch |
| `apps/web/src/shared/ui/*`, `shared/board/*` | primitives + domain blocks, per-group barrels |
| `apps/web/src/app/tablet/*`, `features/day-view/*` | first complete surface |
| `docs/design/globals.css`, `DESIGN.md` | strip `--who-*`; fix 4 terracotta leftovers; record CSS decision |

## 9 Build order (small shippable steps)

1. **`savedEventSchema` in `@homeos/shared`** (corrected shape) — unblocks typed `useEvents`. *Hard
   blocking dependency.*
2. **Token polish:** strip `--who-*` from `globals.css`; fix 4 terracotta word-leftovers; update
   `DESIGN.md` v0.2. *(Polish pass — tokens already ocean/Rubik/12px.)*
3. **Scaffold `apps/web`** (Vite + React 19 + TS + Tailwind v4 + `shadcn init --rtl` dry-run first),
   copy `globals.css`, RTL `index.html`, Rubik only, tsconfig override + aliases, vitest + msw, scripts,
   resolve Biome class-sorting. Add a dev-only `/tokens` swatch route. *(No router yet.)*
4. **Data layer:** `cn`, `date`, `assignee-color`, `events.ts` (`.events` + Bearer), `use-events.ts`;
   msw mocks returning `{ events: [...] }`.
5. **Tablet-only atoms** (only what the tablet slice consumes): PersonChip, SectionHeader, PeekRow,
   NowLine, RuleBar, Skeleton + the `shared/ui` atoms TimeSpine/EventCard need. *Defer the rest.*
6. **EventCard + TimeSpine + AnytimeSidebar** — EventCard accepts `SavedEvent` direct; anti-slop
   regression tests; TimeSpine density prop; container queries.
7. **TabletShell + TabletBoard (FIRST COMPLETE SURFACE)** — ambient kiosk rendering live `/events`;
   NowLine; curate ~5 + "+N more"; no scroll; no AddSheet; View Transitions as progressive enhancement
   over CSS-opacity fallback. **Enables `/design-sync`.**
8. **PhoneShell + phone screens** (week/today/family/settings) + AddEvent Sheet — introduces **TanStack Router** (typed `?date=` search param);
   builds the remaining atoms (Pip, SegmentedControl, Field, DayRow, MemberListItem) where they first
   appear; shared AddItemForm (RHF + zod).
9. **WebShell + web screens** (today/week/family/connections/settings) + AddEvent Modal — same feature
   views; WeekGrid (Sunday-on-right RTL test); drop the prototype's WebBrowserChrome.
10. **Onboarding + WhatsApp Ingestion** flows (lower priority; WA bubbles use literal colors + pop).

## 10 Risks & open questions (every critique blocker/concern folded in)

| Risk / question | Severity | How addressed |
|---|---|---|
| **savedEventSchema wrong vs live server** (`id: number`, `source_provider: string\|null`, `{ events }` wrapper, Bearer-gated, no `created_at`) | **BLOCKER** | Issue #1 uses the corrected shape; `events.ts` reads `.events` + sends Bearer; "just added" cue **cut from MVP** (or a separate backend issue to add `created_at` to `rowToSaved`). Parse test uses a real forwarded row (`source_provider: null`) AND a `google`-derived row. |
| **`--who-*` vars in `globals.css`** re-introduce the hardcoded-key bug | **BLOCKER** | Issue #2 **deletes** them; colors move to `shared/lib/assignee-color.ts`. globals.css carries no assignee-identity color. |
| **Stale-token framing over-weighted** | Concern (resolved) | Issue #2 rescoped to a polish + strip pass (globals.css already ocean/Rubik/12px); fix only the 4 terracotta word-leftovers. |
| **22 components specified before first pixel** | Concern | Inventory is a **reference map, not a build checklist**. Issue #5 builds only what the tablet slice consumes; the rest are deferred into the phone/web issues where they first appear, letting the shared/feature split emerge from second usage. |
| **atom/molecule/organism + 4-granularity barrels = heavy vocabulary** | Concern | Folder has **two buckets** (`shared/`, `features/`); labels are prose only; per-leaf `index.ts` optional. |
| **Router installed too early** | Resolved | **TanStack Router** chosen with Query as ONE unified stack (user opt-in 2026-06-19); not installed until the phone shell (step 8), so the tablet slice has zero routing and no premature ceremony. |
| **Three font families pre-installed** | Concern | Ship **Rubik only**; Frank Ruhl per-component later; Assistant dropped until needed. |
| **Tailwind class-string density vs readability priority** | Risk (weighted) | Decomposition + CVA; `@layer components` for the 3–4 signature pieces; **pivot gate** after EventCard + 2 screens (tokens survive a pivot, so it's bounded). shadcn's own primitive internals stay dense — honestly noted. |
| **Biome has no mature class-sorter** | Risk | Decide accept-unsorted vs `prettier-plugin-tailwindcss` scoped to `.tsx` at scaffold time. |
| **Kitchen-tablet webview version unknown** (color-mix oklab Chrome 111+; View Transitions Chrome 111+/Safari 18+) | Open question | **First-week task: identify the device + webview version.** If < Chrome 111, use the precomputed-wash hex field in assignee-color.ts + solid-color bot-bubble border; View Transitions strictly progressive enhancement over CSS-opacity. |
| **tsconfig.base is NodeNext** | Risk | Web tsconfig overrides ESNext/Bundler/DOM libs (issue #3). |
| **Over-engineering: `packages/ui`** | Risk | Not created. `shared/` stays internal; promote only on a second runtime target — trigger recorded in DESIGN.md. |
| **Surface drift (3 copies of the card)** | Risk | Forbid event/card markup in `app/` shells; shells compose features which compose `shared/board`; surface differences = layout/density only. |
| **shadcn `--rtl` / style-preset maturity** | Risk | Verify with `shadcn init --dry-run` on a throwaway before building screens; fall back to neutral style + manual token apply. |
| **WeekGrid Sunday-on-right under RTL** | Risk | DOM-order `[Sun..Sat]` test + `getBoundingClientRect` x-order check; verify gap-via-bg trick under RTL; test on the throwaway scaffold first. |
| **`source_text` (raw forwarded Hebrew) is in the payload** | Open question | Decide deliberately whether the UI/bundle should carry it (privacy + payload weight) rather than silently shipping it. |
