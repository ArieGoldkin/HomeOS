# ADR 0001 — Host the WhatsApp webhook on Railway (reject serverless)

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Arie (build), Hodaya (product)

## Context

HomeOS needs a permanent home for `@homeos/server` — the always-on WhatsApp webhook that
parses forwarded Hebrew messages. Three properties of the current architecture constrain where
it can run:

1. **Ack-then-process:** the webhook returns `200` immediately, then does the Claude parse +
   persist **asynchronously** (`void handleInbound(...)`). A platform that freezes/kills the
   function after the HTTP response would drop that work.
2. **`node:sqlite`, one file per family:** persistence is a local SQLite file (WAL mode) with a
   nightly `VACUUM INTO` backup — it needs a **real, persistent disk**, not an ephemeral FS.
3. **Boot-replay:** crash recovery re-processes `pending` inbound rows on startup — it assumes a
   **long-running, restartable process**, not per-request isolation.

Plus the standing constraints: solo dev, evenings, ≤ $100/mo (≈ $5/mo until P1), lowest ops, and
a **stable HTTPS URL** is required because Meta delivers webhooks to a fixed address (throwaway
`cloudflared` quick-tunnels rotate every restart and have no uptime guarantee).

## Decision

Host the server on **Railway** — a managed container platform with `git push` deploys, a
persistent **Volume** (mounted at `/data` for the SQLite DB), and a permanent `*.up.railway.app`
URL. Run on **Node 24** (`node:sqlite` is flag-free there). See `docs/DEPLOY.md` for the runbook.

## Alternatives considered

| Option | Verdict |
|---|---|
| **Fly.io** | Viable + cheaper (~$2–3/mo) + more portable (plain Docker), but needs a `Dockerfile`/`fly.toml`. **Kept as the fallback** if cost/lock-in ever matters. |
| **Render** | Equivalent to Railway, but its free tier **sleeps** (fatal for a webhook); paid ~$7/mo. No advantage over Railway. |
| **VPS** (Hetzner/DigitalOcean) | Cheapest + zero lock-in, but you own TLS, deploys, systemd, patching — too much ops for solo evenings. |
| **Serverless** (Vercel / Cloudflare Workers / AWS Lambda) | **Rejected.** Would kill the ack-then-process async work and can't host a local SQLite file — adopting it means re-architecting onto a managed DB (Turso/D1) + an external queue. Not justified at this stage. |
| **Named `cloudflared` tunnel → an always-on home machine** | Free, permanent URL — but depends on that machine + home internet staying up. **Dogfood-only**, not a product host. |

## Consequences

- ~$5/mo; permanent webhook URL configured in Meta **once** (ends the rotating-tunnel pain).
- Some Railway lock-in, but the app is a plain container with env-based config → portable to
  Fly.io later with no code change.
- Requires: a `/data` Volume, `NIXPACKS_NODE_VERSION=24`, and **not** setting `PORT` (Railway
  injects it; the server already reads `PORT`/`DB_PATH` from env).
- At the production-number cutover (#31): enforce the webhook HMAC via `APP_SECRET` (#9) and wire
  the real offsite backup uploader (#10).
- Revisit at multi-tenant / many families (Phase 8): move persistence to Postgres behind the
  existing `EventStore` interface — Railway hosts that equally well.
