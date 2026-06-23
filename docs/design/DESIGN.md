# HomeOS Design System — "Warm Paper × Living Green"

> The visual + interaction system for the HomeOS **family board** webapp: the surface that
> *shows* what the WhatsApp bot captured. Hebrew-first (RTL), **one responsive web app** (phone → desktop),
> with **light + dark** modes. Tokens live in [`globals.css`](./globals.css).

**Status:** v0.3 (2026-06-23) — **supersedes the locked v0.2 "Ocean × Rubik"** below. v0.3 swaps the *skin* to
the imported Claude-design prototypes (`prototype/HomeOS-Modern.dc.html` + `prototype/HomeOS-Design-System.dc.html`),
now the visual source of truth: **warm cream "paper" surfaces + a living green accent + a bold-sans / accent-serif
voice**, paired with a **dark "night gradient"** mode. It also replaces the **three-surface** model
(tablet kiosk / phone / web) with **one responsive authenticated app**. The transition is tracked in
[`web-redesign-plan.md`](./web-redesign-plan.md) (GitHub **milestone #12**, issues #170–#187).
**CSS = Tailwind v4 (CSS-first) + shadcn/ui (copy-in).**

> **What changed from v0.2 → v0.3** (so a reader isn't misled by older docs):
> palette **cool ocean blue → warm paper + living green**; font **Rubik → Heebo (he) / Schibsted Grotesk (en)**
> with an **accent serif** (Frank Ruhl Libre upright for Hebrew, Newsreader italic for English) + **Spline Sans
> Mono** for captions; **single-accent "anti-rainbow" rule dropped** — a small named accent set (blue/violet/coral/
> spark) is now allowed for people/status/events; **"OKLCH only / never #FFF/#000" dropped** — the prototype is
> HEX and uses #FFFFFF surface + #1B1A17 ink; **dark mode is now a user toggle** (not the always-on tablet);
> **three surfaces → one responsive app**; **the no-auth kiosk is retired**.

---

## 1. North star

The board's job — in the founder's words — is **redistributing mental load by making it visible**, not being a
prettier calendar. It must read as **a calm, designed home the family owns, not an app a tool generated.**

One responsive app, two postures of the same surface:

- **Phone (default reach)** — held, one-handed, interactive; the everyday "what's today / this week, and is
  anything mine?" The nav rail collapses to a bottom bar; the Add host becomes a bottom sheet.
- **Desktop / wide** — the same screens breathe into a 66px icon rail + scrollable column (max-w ~1040), 2-col
  card grids, the 7-col week grid, the People data table.

*(A dedicated kitchen-tablet ambient display returns later as a separate surface; the v0.2 no-auth kiosk was
retired in milestone #12.)*

## 2. The direction (how the tension resolves)

Adopt the **shadcn/ui chassis**, ship our **Warm Paper × Living Green soul**:

- **From shadcn:** the Tailwind-v4 token system as the single source of truth (one file every component
  inherits = the *mechanical* anti-slop defense), the copy-in / own-the-source model, official **RTL** (logical
  classes by construction), and Radix-grade primitives (Dialog/Sheet/Popover) we shouldn't hand-build.
- **Stay distinctive:** warm **cream paper** surfaces (never gray/zinc); a **living green** primary; a
  **bold-sans + accent-serif** voice (the accent serif carries a *single* emphasised phrase per heading —
  e.g. the name in *"Good morning, Maya"*); **mono captions** for dates/labels; **soft radii + quiet shadows**;
  and a **dark "night gradient"** mode that is a real user preference, not a hardware mode.

## 3. Stack

| Layer | Choice |
|---|---|
| App | React + Vite + TypeScript, `platform/apps/web/`, consumes `@homeos/shared`. **One responsive app** (no phone/web/tablet split). |
| Styling | **Tailwind v4** (CSS-first) + shadcn/ui (copy-in, RTL); tokens = HEX/oklch CSS vars in `globals.css`. |
| Theming | **Light (paper) / dark (night gradient)** via a `data-theme` attribute on `<html>` + a `ThemeProvider` (`useTheme`), persisted to `localStorage`; `prefers-color-scheme` as first-run default; anti-FOUC inline boot script. |
| Fonts | **Hebrew-first 3 roles** — sans **Heebo** (he) / **Schibsted Grotesk** (en); accent serif **Frank Ruhl Libre** upright (he) / **Newsreader** italic (en) via `--accent-style`; mono **Spline Sans Mono**. **Self-hosted** (fontsource), subset to the weights used (≤$100/mo). |
| Motion | Restrained, composite-only (`transform`/`opacity`); `prefers-reduced-motion` honored. Signature: the hairline rule drawing in + "ink-not-dry" skeletons. |

## 4. Tokens

The authoritative list is [`globals.css`](./globals.css). Defined for both **light** (`:root`) and **dark**
(`[data-theme="dark"]`); `dark:` utilities map to the attribute. Sourced verbatim from the prototype LIGHT/DARK maps.

- **Warm neutrals (paper, never gray):** `--background` paper `#F4F1EB` · `--card` surface `#FFFFFF`
  (`--card-border` ~`#ECE7DD`) · `--muted`/`--secondary` `#E9E5DD` · ink `--foreground` `#1B1A17`, softer
  ink-2 `#3A372F` / ink-soft `#56524B` / `--muted-foreground` `#8A8579`. `--border` `#E2DDD3`, `--input` `#D8D2C6`.
- **Living accents (one chroma, hue varies):** `--primary` green `#1E9E6F` (dark: `#23B083`) + `--ring`.
  Named accents for people/status/events: blue `#3686D8`, violet `#B57BD6`, coral `#D9543F` (`--destructive`),
  spark yellow `#FFD81F`.
- **Surfaces:** white content **Card**, muted-beige grouping **Card**, and a **dark-glass Card** (translucent
  gradient + `backdrop-filter: var(--card-blur)`; `--card-blur` = blur(0) light / blur(16px) dark). The dark
  `--background` is a multi-stop gradient over `#11151B`.
- **Structure:** radii **sm 8 / md 14 / lg 20 / pill** (card ≈ 18–20); elevation **flat / card / float**; 4-pt spacing.
- **Domain:** `kind` (event/task/reminder) signalled by **form** (pip / checkbox / accent-title), never a colored
  left-border. `--wa-green` is the literal WhatsApp brand green (Connections / WhatsAppBubble only, **not** `--primary`,
  **not** token-recolored). **Assignee color is a RUNTIME concern** (`shared/lib/assignee-color.ts`), selected by the
  active theme — retuned to agree with the named accent set.

## 5. Typography

- **Sans (everything):** **Heebo** (Hebrew-native, the default) / **Schibsted Grotesk** (English) — headings, dates,
  titles, body, chips. Weights 400–800.
- **Accent serif (ONE emphasised phrase per heading, never body, never twice):** **Frank Ruhl Libre** *upright* for
  Hebrew / **Newsreader** *italic* for English — the face flips italic by **language** (`--accent-style`), not by dir.
- **Mono:** **Spline Sans Mono** for eyebrows/captions/dates (e.g. "Monday · June 22").
- `font-variant-numeric: tabular-nums` on all times/dates; isolate LTR atoms (time/phone/URL) with `dir="ltr"`/`bdi`.

## 6. Color & accent discipline

Green is the **one primary** (CTAs, now-line, today, focus ring, "go") — restricted to **fills/buttons**, not body
text (small green on white is marginal for WCAG). The named accents (blue/violet/coral/spark) carry **people, status
pills, and event chips** — a *bounded* palette, not a rainbow; member avatars, event chips, and the accent vocabulary
must agree (reconciled in `assignee-color.ts`). Neutrals stay **warm-tinted, never pure gray**.

## 7. Depth, radius, spacing

- **Depth:** quiet shadows (**flat / card / float**); dark mode uses translucent glass + `--card-blur`. **No glow,
  no saturated glassmorphism.**
- **Radius:** discrete **8 / 14 / 20 / pill** (card ≈ 18–20); `999px` for pips/avatars.
- **Spacing:** **4-pt** rhythm (4/8/12/16/24/32/48).

## 8. Components

One responsive **AppShell** = 66px left icon **nav rail** (collapses to a bottom bar < md) + **header** (wordmark +
mono tag · a render-only describe-it **command-bar** placeholder *(wiring deferred)* · theme paper/night toggle ·
first-run button · avatar) + scrollable `<Outlet/>`.

Shared primitives: `Card` (surface / muted / glass) · `StatusPill` (Active green / Pending blue / Overdue coral /
Archived slate) · `Switch` (RTL-aware knob) · `Button` (green primary / **ink** / ghost / dashed) · `SegmentedControl`
(theme + lang toggles) · `Modal`+`Sheet` (one responsive host each for Add + Event Detail) · `PersonChip` / `PersonAvatar`
· `EventCard` (kind-by-form) · a People **data table** (avatar lead + status pill) · the **WhatsAppBubble** (literal
brand colors, theme-independent).

Screens (one set, no surface split): **Today** (greeting + card grid over the day schedule), **Calendar** (7-col week
grid / list at phone width), **People** (stat chips + data table), **Connections** (WhatsApp channel + how-it-works +
recent ingestion feed + linked members), **Settings** (profile / appearance / connected / notifications), plus the
**Add** modal and the **Onboarding** wizard. *(Net-new — Lists, the wired command bar, Celebrations, the Tonight
banner — are deferred; see the plan doc.)*

## 9. RTL / Hebrew

`<html dir="rtl" lang="he">` (default). **Logical properties only** (`ms-*`/`me-*`, `start`/`end`, `border-inline-end`).
Week starts **Sunday** (grid `direction:rtl` → Sunday rightmost). The Switch/Segmented knob translate flips sign by dir.
`dir` + `lang` + font swap are **one coordinated switch** (so EN/LTR can drop in later without desync); the accent serif's
italic flips by **language**, not dir. Directional icons `rtl:rotate-180`.

## 10. Motion

Restrained, "ink not pixels." Composite-only (`transform`/`opacity`); `prefers-reduced-motion` is table stakes.
Functional micro-interactions (press `scale(0.98)`, spring on the edit sheet, ~300–450ms theme crossfade). Signature
gestures: the **hairline rule drawing in** when a new event lands (the trust cue) and **ruled "ink-not-dry" skeletons**
(never shimmer-sweep). Durations capped ~300ms, ease-out.

## 11. Accessibility

WCAG AA contrast (green for fills, not body text); visible `:focus-visible` ring (`--ring`, `outline-offset: 2px`);
≥44px touch targets; `kind` / assignee / done conveyed by **shape + text**, not color alone; `<time datetime>` +
`aria-current`; the People status dot keeps its Hebrew aria-labels. Verify dark-mode contrast (glass cards over the
gradient) at small sizes.

## 12. Anti-slop rules (hard bans)

1. **No colored left-border on event cards** — encode `kind` by **form** (pip / checkbox / accent-colored title).
2. **No glassmorphism *as decoration*** — the dark-glass Card is a deliberate token (`--card-blur`), not a glow; no
   saturated glows in either mode.
3. **No all-caps Hebrew section labels** (eyebrows are mono, sentence/upper per the prototype's mono caption style).
4. **No shipping a famous tweakcn preset unchanged.**
5. **Accent serif is rationed** — one emphasised phrase per heading, never body, never twice; don't blanket-swap
   `font-display` to the serif (that reads as editorial slop).
6. **Don't recolor intentional brand/literal colors** — WhatsAppBubble green + the message outcome semantics stay as-is.

*(Retired from v0.2: the single-accent "one ocean moment per view" rule, the "OKLCH only / never #FFF/#000" rule, and
the "no Heebo" font ban — the new system deliberately uses Heebo, HEX surfaces, and a bounded multi-accent palette.)*

## 13. Open questions / deferred (carry-overs)

- **Real per-user auth is deferred** (milestone #12 decision). "Authenticated app" = no ambient no-auth surface; the
  READ/WRITE/MESSAGES tokens remain build-embedded family-shared secrets in the single bundle. A real login/PIN/provider
  is a separate backend workstream.
- **Net-new surfaces deferred:** Lists (needs its own backend), the agent-wired command bar, Celebrations, the
  Tonight-dinner banner, the full he/en language-toggle UI (token plumbing built now), tri-state "system" theme,
  persisted task-`done`.
- **Schema gap (still open):** a confidence / needs-review flag on `ParsedEvent` for the "needs a look" trust state.

## 14. Provenance

- Source of truth: `prototype/HomeOS-Modern.dc.html` + `prototype/HomeOS-Design-System.dc.html`
  (claude.ai/design project `4085dcac-…`, imported 2026-06-23). Tokens: [`globals.css`](./globals.css). Transition
  plan: [`web-redesign-plan.md`](./web-redesign-plan.md). Earlier system: v0.2 "Ocean × Rubik" (git history of this file).
