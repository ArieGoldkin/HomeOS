# HomeOS Roadmap

> Canonical milestone plan + integration points toward the MVP. Mirrored as
> [GitHub milestones](https://github.com/ArieGoldkin/HomeOS/milestones).
> **Phase-based, not date-based** (solo dev, evenings, ≤$100/mo).
> **Foundation-first:** every phase grafts onto the previous phase's code — nothing thrown away.

## North star — the MVP

A WhatsApp-first, Hebrew, privacy-first family command center. The MVP end state:

> Forward a Hebrew message → a **tool-using agent** turns it into structured data, enriched by
> **Gmail + Google Calendar**, **analyzed and prioritized** into the family's home tasks, and
> surfaced on a **single dashboard app** (with a kitchen-tablet kiosk view). **Optional:**
> proactive notifications when something needs attention.

**Moat = trust + the surface that makes household mental load visible** — *not* scale. Trust =
privacy-first allowlist + official WhatsApp Business API. The dashboard (and its kitchen-tablet
kiosk view) is the wedge vs FamilyOS.

## Status

- ✅ **M1** — echo bot (receive → send).
- ✅ **M2** — forward → Claude parse → SQLite → Hebrew confirm. *Demo 2 live 2026-06-15.*
- 🚧 **Phase 3 — Trust Spine & Read API** — items **A** (DB-as-queue) and **F** (Hebrew confirm date)
  shipped in **PR #3**; C / D / B / E / G / H remain.

## Phases

### Phase 3 · Trust Spine & Read API
Harden the write path so dogfooding is safe, and expose the read seam the UI will consume.
- **Items:** A ✅ DB-as-queue (idempotency + durability) · F ✅ friendly Hebrew confirm date ·
  C visible + undoable misparses · D daily self-digest WhatsApp · B golden eval set (Hebrew dates) ·
  E `GET /events` read endpoint · *(design-now)* G `ParsedEvent[]` + recurrence contract ·
  H X-Hub-Signature-256 HMAC raw-body seam.
- **Exit:** the bot won't silently lose or garble an event, misparses are recoverable, and
  `GET /events` is a stable, contract-locked read seam.
- **Integration points:** **`GET /events` JSON** (the seam the dashboard + kiosk read) and the
  **`ParsedEvent[]` contract** (locked in `@homeos/shared` before any UI consumes it).

### Phase 4 · Agent Core
Evolve the single Claude parse call into a **tool-using agent** (Claude function-calling). The
agent decides parse-vs-act and invokes tools; the existing parse becomes one tool.
- **Exit:** a forwarded message is handled through the agent's tool loop, with the M2 parse path
  preserved as a registered tool.
- **Integration point:** the **agent tool interface** (`tools/`) — the single seam every external
  capability below (Calendar, Gmail, notifications) plugs into.

### Phase 4b · Voice Notes *(optional, parallel)*
Graph media download + local `mlx_whisper` Hebrew STT → the **same** parse/agent pipeline.
- **Exit:** a forwarded voice note becomes an event like text does.
- **Integration point:** grafts onto `parsing/` + `whatsapp/media`. Deferred per the
  dashboard-first call; not on the MVP critical path.

### Phase 5 · Gmail + Google Calendar
Per-family, opt-in Google integration behind the agent's tool interface.
- **Exit:** emails and calendar events flow into the board through agent tools; parsed events can
  be written to the family Google Calendar.
- **Integration points:** **Google OAuth** (per-family, opt-in; secrets in env/secret store) ·
  **Gmail API tool** (read → extract events/tasks) · **Google Calendar two-way sync tool**.

### Phase 6 · Prioritization & Dashboard *(= MVP complete)*
The engine that aggregates all sources (forwarded messages, Gmail, Calendar, tasks) and
**prioritizes home tasks**, surfaced in a **single React dashboard**. The **kitchen-tablet is a
read-only kiosk view of the same app** (not a separate build). UI design is iterated here.
- **Exit:** the dashboard shows a prioritized home-task view across all sources; a dogfood month
  validates the moat (forward habit ≥1/day, parse accuracy ~80%+, daily board glances).
- **Integration points:** **prioritization service** over the unified EventStore data ·
  **dashboard ↔ read API** (extends `GET /events` into a board/tasks view with priority).

### Phase 7 · Notifications *(optional)*
Proactive nudges when a high-priority task needs attention. Gated on the dashboard proving value.
- **Exit:** a high-priority item triggers a WhatsApp template / push notification.
- **Integration point:** **notification dispatch** — reuses `whatsapp/client` + the scheduler
  introduced for the daily digest (D).

### Phase 8 · Multi-Family *(post-MVP / End Goal)*
Lift the same pipeline to multi-tenant with auth + billing.
- **Exit:** more than one family runs on the platform with isolated data and a billing path.
- **Integration point:** tenancy boundary — **one-file-per-family preserved**, Postgres adopted
  behind the `EventStore` interface only if/when needed (no `family_id` shared-DB column).

## Cross-cutting integration points (the stable seams)

These are the contracts that must stay stable as phases graft on:

1. **`ParsedEvent[]` contract** (`@homeos/shared`) — produced by server/agent, consumed by the
   dashboard + kiosk. Lock the array + recurrence shape in Phase 3 (item G) before any UI exists.
2. **`GET /events` read API** — the only way the UI reads the board; decoupled from write-path bugs.
3. **Agent tool interface** (`tools/`) — where Gmail, Calendar, and notifications plug in.
4. **Google OAuth** — the per-family, opt-in credential for Gmail + Calendar.
5. **`EventStore` (one family = one SQLite file)** — the durable data every analysis reads;
   the swap-to-Postgres seam for Phase 8.

## Guardrails (locked from day one — never break these)

- ⚡ **Ack-then-process** webhooks; idempotent on `wa_message_id` (now DB-backed — Phase 3/A).
- 🔒 **Allowlist + official WhatsApp Business API only** — process forwarded/allowlisted messages
  only, never all chats. The privacy red line and the only ToS-legal path.
- 🚫 **Single-purpose bot** — family scheduling/tasks only; no open-domain chat (Meta 2026 policy).
- **Hebrew is first-class**; anchor dates to **Asia/Jerusalem**.
- **Foundation-first**; all code under `platform/`, repo root stays clean.

---
*Created 2026-06-15. Supersedes the linear `M1→M2→P1→EG` view in
`docs/idea/architecture-roadmap-playground.html` with the agent + Gmail/Calendar + dashboard MVP.*
