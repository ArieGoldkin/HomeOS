<!-- Authored 2026-06-23 from /etk:auto-research → a 7-agent analysis workflow (5 analysts → synthesis →
adversarial completeness critic, verdict "needs-minor-fixes" with fixes folded). Source of truth = the imported
Claude-design prototypes docs/design/prototype/HomeOS-Modern.dc.html + HomeOS-Design-System.dc.html. Tracked as
GitHub milestone #12; issues #170–#187. -->

# HomeOS — Web Redesign Plan (Phase 6b)

> Shift the web app to the new **"Warm Paper × Living Green"** design system, **collapse the three surface shells
> (tablet kiosk / phone / web) into ONE responsive authenticated app**, add **light + dark** mode, and **re-skin
> every existing screen**. Foundation-first; nothing reusable is thrown away. See [`DESIGN.md`](./DESIGN.md) for the
> system and [`web-architecture-plan.md`](./web-architecture-plan.md) for the architecture.

**Milestone:** [#12 "Phase 6b · Web redesign — warm-paper design system, one responsive app"](https://github.com/ArieGoldkin/HomeOS/milestone/12) · **18 issues #170–#187.**

## Locked decisions

1. **Re-skin + collapse.** Adopt the design system; merge `TabletShell`/`PhoneShell`/`WebShell` into one responsive
   shell (66px icon rail ≥ md, collapsing to a bottom bar < md + top header + scrollable main). Re-skin **existing
   screens only** — Today (=day-view), Calendar (=week-view), People (=family), Connections (=connections +
   messages/ingestion), Settings (=settings), Add (=add-event), Onboarding (=onboarding). **No** phone/web/tablet
   routing; **no** attachments.
2. **Retire the no-auth tablet kiosk.** Delete `app/tablet/*` + the `/` route + the kiosk-exclusion machinery
   (#135 messages, #153 EventDetail/EventCard). Result = one responsive app, **light default + user dark toggle**.
3. **Real per-user auth is DEFERRED.** "Authenticated app" = no ambient no-auth surface. `READ`/`WRITE`/`MESSAGES`
   tokens stay **build-embedded family-shared secrets in the single Vite bundle** (they always were — there is one
   build, never a kiosk-only bundle). The **distinct `MESSAGES_TOKEN`** + the server `/messages` allowlist filter
   are **kept** as defense-in-depth; only their kiosk-justifying comments change.

## Why it's mostly mechanical

Nearly every visual component reads semantic tokens from `styles/globals.css`, so swapping the token *values*
(keeping the `@theme inline` + `@custom-variant dark` plumbing) reskins the app. The high-value reuse — `shared/board`
(EventCard, PersonChip, TimeSpine, …), `shared/ui`, and the entire data/hooks/api/lib layer — carries forward. The two
real builds are (a) one responsive **AppShell** replacing the three shells, and (b) the **token + light/dark + font**
rewrite of `globals.css`.

## Issue breakdown (4 phases)

| # | Key | Issue | Depends on |
|---|---|---|---|
| #170 | A1 | `globals.css` → paper+green tokens (light+dark maps), `night→dark`, radii 8/14/20, shadows flat/card/float | — |
| #171 | A2 | Font swap → Heebo/Frank Ruhl (he) / Schibsted/Newsreader (en) / Spline Mono; 3-role token plumbing + `--accent-style` | #170 |
| #172 | A3 | ThemeProvider + `useTheme` (toggle, localStorage, anti-FOUC); reconcile the `index.html` dir/lang pin in ONE place | #170 |
| #173 | A4 | Retire the `night` prop → theme context; reconcile assignee colors to the accent set | #170, #172 |
| #174 | A5 | Shared primitives: Card (surface/muted/glass), StatusPill, RTL-aware Switch, `ink` button variant | #170, #171 |
| #175 | B1 | Single responsive **AppShell** (icon rail + header); delete Phone/Web shells + nav | #170, #171, #174 |
| #176 | B2 | **Retire the kiosk** — delete `app/tablet/*` + the `/` route (extract greeting util first) | #173 |
| #177 | B3 | Collapse router → flat `/today /calendar /people /connections /settings` + `/lists` stub; merge per-surface wrappers incl. `PhoneToday`; drop `/web/messages` + `/ingestion` | #175, #176 |
| #178 | B4 | Lists nav stub + render-only command-bar placeholder (deferred surfaces wired safely) | #175, #177 |
| #179 | C1 | Re-skin **Today** — greeting header + card grid over the schedule (migrate/delete `PhoneToday`; task-done deferred) | #177, #174 |
| #180 | C2 | Re-skin **Calendar** — consolidate `WeekView`+`WebWeekView` into one responsive view | #177, #174 |
| #181 | C3 | Re-skin **People** — stat chips + avatar data table (reconcile `StatusDot` a11y) | #177, #174 |
| #182 | C4 | Re-skin **Connections** — merge connections + ingestion how-it-works + recent `/messages` feed | #177, #174 |
| #183 | C5 | Re-skin **Settings** — Profile / Appearance (theme toggle) / Connected / Notifications (Switch) | #177, #172, #174 |
| #184 | C6 | Unify + re-skin **Add** (modal/sheet→one host) & **Event Detail** (drawer); relax the #153 source_text red line | #177, #174 |
| #185 | C8 | Re-skin **Onboarding** wizard; `onDone→/today`; re-trigger from header first-run button | #177, #174 |
| #186 | D1 | Update stale kiosk/token comments in server + shared; verify single Vite bundle / no kiosk-keyed build | #176 |
| #187 | D2 | Re-skin dev TokensView + update CLAUDE.md status & `apps/web/README.md` | #170, #171, #174, #182, #176, #186 |

*(C7 from the synthesis — board comment/test reframing — was folded into A4/B2/C6, which already touch those files.)*

## Build order

**Foundation (A1–A5)** → **Shell collapse + kiosk retirement (B1–B4)** → **Re-skin screens (C1–C6, C8)** →
**Cleanup + docs (D1–D2)**. Each issue is sized to one solo-evening PR; keep the suite green (TDD) at every step.

## Net-new surfaces — DEFERRED (NOT in this milestone)

- **Lists screen** (grocery/errands) — the only deferred surface with real backend cost (a list-items store/table,
  GET/POST endpoints, a new `@homeos/shared` schema). The rail ships a routed "coming soon" stub.
- **AI describe-it command bar** wired to the agent (header shows a render-only placeholder; respect the single-purpose-bot guardrail).
- **Celebrations card** + **Tonight-dinner banner** on Today (need data sources that don't exist; the Today grid is built so they drop in without rework).
- **Full he/en language-toggle UI** (the lang/dir/font-swap token plumbing is built now; the EN control + copy + LTR verification ship later).
- **Real app-entry auth** (login/PIN/provider) — separate backend workstream.
- **Tri-state "system / light / dark"** theme; **persisted task-`done`**; re-evaluating whether the raw `/messages`
  feed belongs in the family bundle long-term.

## Security posture (flagged, not silently changed)

Retiring the kiosk removes the only *intentional* no-auth surface — a net improvement — but does **not** add real
auth. The single static bundle still ships the family-shared bearer tokens; anyone with the URL + bundle has full
read/write/raw-feed access (they always did). The `MESSAGES_TOKEN` (raw pre-allowlist text) stays a distinct privilege
+ the server allowlist filter stays. Real auth is a tracked follow-up. The #153 privacy invariant ("no source_text on
a no-auth surface") is **consciously retired** (the surface it protected no longer exists) — documented in PRs B2/C6,
not silently dropped.

## Doc updates (this milestone)

- `DESIGN.md` → rewritten to v0.3 "Warm Paper × Living Green" (done up front). 
- `web-architecture-plan.md` → "Web redesign (Phase 6b)" section (done up front).
- `globals.css` file-top banner → A1/A2. `CLAUDE.md` status + `apps/web/README.md` → D2.
