# HomeOS Design System — "Ocean × Rubik"

> The visual + interaction system for the HomeOS **family board** webapp: the surface that
> *shows* what the WhatsApp bot captured. Hebrew-first (RTL), responsive across a **kitchen-tablet
> ambient display** and a **phone companion**. Tokens live in [`globals.css`](./globals.css).

**Status:** locked v0.2 (2026-06-19). v0.1 (2026-06-18) established the system *shape*; v0.2 swaps the
*skin* to the imported Claude-design prototype (`prototype/HomeOS-Prototype.dc.html`, palette default
**ocean**) — now the visual source of truth: cool blue-grey paper + a single **ocean** accent + **Rubik**,
replacing v0.1's terracotta / warm-brown / Frank-Ruhl-led palette. Tokens in [`globals.css`](./globals.css).
**CSS = Tailwind v4 + shadcn** (evaluated vs CSS Modules — see `web-architecture-plan.md`). Not yet built as components.

---

## 1. North star

The board's job — in the founder's words — is **redistributing mental load by making it visible**,
not being a prettier calendar. Everything serves two postures:

- **Kitchen tablet** — ambient, glanced from **~2m, hands-full, never touched**, always-on (incl. night).
  Answers *"what's today, and is anything mine?"* in **≤3 seconds without interacting**.
- **Phone** — held, one-handed, interactive. Answers *"what's this week,"* and is the **only** place you edit.

It must read as **a designed almanac the family owns, not an app a tool generated.**

## 2. The direction (how the tension resolves)

Adopt the **shadcn/ui chassis**, ship our **Ocean × Rubik soul**:

- **From shadcn:** the Tailwind-v4 OKLCH token system as the single source of truth (one file every
  component inherits = the *mechanical* anti-slop defense), the copy-in / own-the-source model,
  official **RTL** (`init --rtl` → logical classes by construction), and Radix-grade primitives
  (Dialog/Sheet/Calendar/Popover) we shouldn't hand-build. Scaffold from the **Sera** (editorial) style.
- **Stay distinctive:** **Rubik** (friendly, Hebrew-native sans) as the primary + display face (Frank Ruhl
  Libre kept available as `--font-serif` for a per-component editorial mode); **single-accent discipline
  enforced in tokens** (one **ocean** accent); **hairlines, not shadow-cards**; a **cool night** variant
  (hue ~238, not warm brown); **12px radius** (the prototype "calm" shape); and three signature tokens
  shadcn never ships — `--hairline`, `--shadow-paper`, `--grain`.

## 3. Stack

| Layer | Choice |
|---|---|
| App | React + Vite + TypeScript, new workspace under `platform/apps/web/`, consumes `@homeos/shared` `ParsedEvent` |
| Styling | **Tailwind v4** (CSS-first) + shadcn/ui (copy-in, `init --rtl`, Sera style); tokens = OKLCH CSS vars |
| Components | shadcn (Radix) base; Origin UI (Timeline, rich Dialog/Autocomplete) + Kibo UI (calendar/board). **Skip** Aceternity (marketing spectacle). |
| Fonts | **Rubik** (`--font-sans` + `--font-display`, the MVP "friendly" face — **ship Rubik only**); **Frank Ruhl Libre** kept as `--font-serif` (per-component editorial mode, package added only when used); **self-hosted** (`@fontsource-variable/rubik`), subset hebrew+latin, `font-display:swap` (offline tablet, ≤$100/mo) |
| Motion | **View Transitions API** = primary engine on the board (tablet ships **no Motion JS**); **Motion v12** phone-only (`motion/react`) for the edit sheet / swipe-to-complete; `MotionConfig reducedMotion="user"` |

## 4. Tokens

The authoritative list is [`globals.css`](./globals.css). Semantic groups:

- **Surfaces (cool paper, never white/zinc):** `--background` / `--card` / `--popover` / `--secondary` / `--muted` (oklch hue ~225).
- **Ink (deep cool grey, never black):** `--foreground` / `--secondary-foreground` / `--muted-foreground` (meta only, ≥14px).
- **The one accent:** `--primary` = ocean `oklch(0.55 0.10 228)`; `--ring` = `var(--primary)`. Night
  lightens to `oklch(0.72 0.11 222)`. `--accent` is kept a **cool neutral** on purpose (hover/selected ≠ a 2nd hue).
- **Structure:** `--border`/`--input` are cool low-chroma hairlines; `--radius` = **12px**.
- **Signature (anti-slop):** `--hairline`, `--shadow-paper` (one bespoke shadow used everywhere), `--grain`.
- **Domain:** `--event`/`--task`/`--reminder` (signalled by **pip / title-color, never a colored border**).
  `--wa-green` is the WhatsApp status green (Connections only, **not** `--primary`). **Assignee color is a
  RUNTIME concern** (`shared/lib/assignee-color.ts`), not a token — the v0.1 `--who-*` vars are removed.

Both **light** (`:root`) and **night** (`[data-theme="night"]`) are defined; `dark:` utilities map to night.

## 5. Typography

- **Rubik** (friendly Hebrew-native sans) for the MVP — headings, dates, section titles, event titles
  (500–700) AND body / meta / chips / eyebrows. **Frank Ruhl Libre** (serif) stays available via
  `--font-serif` for a per-component editorial accent (e.g. a tablet masthead title), added only when used.
- **Avoid** Heebo (echoes Android-system Roboto) and the slop fonts Inter / Geist / Space Grotesk / Roboto.
- Fluid `clamp()` scale (one system, no breakpoint snapping). `font-variant-numeric: tabular-nums` on all
  times/dates. Eyebrows are **sentence-case with tracking — never all-caps** (the all-caps Hebrew-label tell).

## 6. Color & accent discipline

Exactly **one ocean moment per view** (today-marker / now-line / primary CTA / focus ring). Everything
else is cool paper neutral. Neutrals are **tinted, never gray** — drop paper chroma to 0 and it reads as slop.
Charts derive from the one accent + warm neutral steps (no rainbow).

## 7. Depth, radius, spacing

- **Depth:** hairlines + the single `--shadow-paper` (`inset 0 1px 0` paper-edge in light; `none` in night).
  One soft float shadow is allowed **only** on the phone (edit sheet / popover). **No glass, no glow, no
  generic drop shadows.**
- **Radius:** **12px** (`--radius`, the prototype "calm" shape). `999px` reserved for pips/avatars. The generic 10px default is the template tell — 12px is a deliberate choice, not a default.
- **Spacing:** 8pt rhythm (`--space-1..8` in the explorer); comfortable on phone, generous-glance on tablet.

## 8. Components

`Button` (ocean primary; secondary = absence of color) · `Card` (hairline-divided via `data-slot`,
flat `--shadow-paper`) → base for **EventCard** · `Dialog`+`Sheet/Drawer` (phone edit; rises on block axis
for RTL safety) · `Calendar` (week-starts-**Sunday**, Asia/Jerusalem, tabular-nums) · `Checkbox` (task /
swipe-complete) · `Tabs` (day/week; directional chevrons `rtl:rotate-180`) · `Popover` · `Badge/Chip`
(status + **assignee pip**) · `Select/Combobox`+`Autocomplete` (Origin UI) · `Timeline` (Origin UI — agenda)
· `Separator` (**the hairline divider — primary structural element**) · `Sonner/Toast` (phone confirm) ·
`Sidebar` (phone only; **text labels, no emoji icons**).

**`kind` is encoded by FORM, not color** (survives grayscale + color-blindness): plain = event ·
`□` checkbox = task · **reminder = leading ocean (`--primary`) pip OR primary-colored title in Rubik** (see §10).

## 9. Surfaces & layout

- **Tablet → TODAY ambient (default):** masthead + a time-spine of timed events + an "anytime today" band +
  a quiet "tomorrow" peek + an ocean now-line. **Never scrolls** — it *curates* (next ~4–5 + "+N more").
  Assignee shown **color-first** (pip/initial), not a name to parse at 2m. Optional secondary: 7-col
  Sunday-rightmost week grid.
- **Phone → THIS WEEK (default):** 7 day-rows Sunday-first, today emphasized, assignee pips + counts;
  **tap a day → the single-column day agenda** (EventCard stack). Enumerates and scrolls.

## 10. Motion

Restrained, "ink not pixels." Composite-only (`transform`/`opacity`), `prefers-reduced-motion` is table
stakes. Tablet = near-static (data-driven entrance/reorder + the clock now-line, via View Transitions + CSS).
Phone = functional micro-interactions (press `scale(0.98)`, spring on edit, ~400–600ms day→night crossfade).
Signature gestures: the **hairline rule drawing in right→left** when a new event lands (the trust cue), and
**ruled "ink-not-dry" skeletons** (never shimmer-sweep). Durations capped ~300ms, ease-out, no spring/bounce.

## 11. RTL / Hebrew

`<html dir="rtl" lang="he">`. **Logical properties only** (`ms-*`/`me-*`, `start`/`end`) — `init --rtl`
generates components this way. Week starts **Sunday** (maps `recurrence.weekday` 0→6; grid `direction:rtl`
puts Sunday rightmost). Isolate LTR atoms (time/phone/URL) with `dir="ltr"`/`bdi`. Directional icons
`rtl:rotate-180`.

## 12. Anti-slop rules (hard bans)

1. **No colored left-border on event cards** — the research's #1 "AI tell." Use an **ocean (`--primary`) pip** or a
   **primary-colored title**. *(The EventCard anti-slop test is the canonical contract — see `web-architecture-plan.md` §4.)*
2. **No emoji nav icons** on the tablet.
3. **No all-caps Hebrew section labels.**
4. **No glassmorphism / Liquid-Glass / saturated glows** (especially night).
5. **No shipping a famous tweakcn preset unchanged** (Supabase / Amethyst Haze / Catppuccin are now as
   recognizable as the default) — use tweakcn only to author/export *our own* OKLCH blocks.
6. **No generic type** (Inter / Heebo / Geist / Roboto) — **Rubik** is the chosen Hebrew-native voice (Frank Ruhl available for editorial accents).

## 13. Accessibility

WCAG AA contrast (ink-3 ≥14px only; accent-as-text uses the stronger step); visible `:focus-visible` ring
(ocean `--primary`, `outline-offset: 2px`); glanceable type at 2m on tablet; ≥44px touch targets on phone;
`kind`/assignee/done conveyed by shape + text, not color alone; `<time datetime>` + `aria-current` semantics.

## 14. Open questions (carry-overs)

- **Schema gap:** the misparse-catch ("needs a look") + "just added" trust states want a **confidence /
  needs-review flag** on `ParsedEvent` — genuinely missing end-to-end (parser + schema + store). Per-item
  `id` already exists on the served `SavedEvent`; `created_at` exists in the DB but isn't in the served shape.
- **Tablet runtime:** does the kitchen tablet run a modern browser (Chrome 111+/Safari 18+ for View
  Transitions)? If an older webview, we need a CSS-transition fallback for board reordering.
- **Sera maturity:** verify the Sera style scaffolds cleanly with RTL on; else start from Vega and override more.
- **Night ocean-accent contrast** (night `--primary` `oklch(0.72 0.11 222)` on `--background` `oklch(0.21 0.022 238)`) needs an AA pass at 2m.
- **Frontend placement:** confirm `platform/apps/web/` as the new workspace; whether tokens/fonts get a
  shared package for tablet+phone reuse.

## 15. Provenance

- Tokens: [`globals.css`](./globals.css) · explore live: [design playground](../idea/homeos-design-playground.html) · earlier: [v0 mockup](../idea/homeos-design-system-v0-playground.html)
- Key sources: shadcn theming / RTL / Sera changelogs; *"The shadcn trap"*; *"AI Design Slop: 16 patterns"*;
  Tubik 2026 trends; tweakcn; View Transitions (MDN); Motion v12; Emil Kowalski on restraint. (56 sources total.)

---

## Next step → enabling `/design-sync`

`/design-sync` uploads a **built component library** to claude.ai/design. This doc + `globals.css` are the
**spec**; the prerequisite is scaffolding `platform/apps/web/` (Vite + Tailwind v4 + shadcn `init --rtl`),
dropping `globals.css` into `src/`, and building EventCard / DayColumn / NightBoard. Once those compile,
`/design-sync` can push the real components so future designs are made of HomeOS's actual parts.
