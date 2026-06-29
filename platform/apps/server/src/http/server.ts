import { randomUUID } from "node:crypto";
import { eventStatusPatchSchema, type InboundMessageDTO, parsedEventSchema } from "@homeos/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { normalizePhone } from "../core/allowlist.ts";
import type { EventStore } from "../db/event-store/index.ts";
import type { FamilyStore } from "../db/family-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
// #229 — the web read/write surface (served DTO family_id, setEventStatus) still uses the single-family
// FAMILY_ID. DEFERRED with the OAuth path (see oauth-routes/): it resolves via the session identity,
// which doesn't exist until #226. The bot WRITE path — the chokepoint with no RLS backstop — is fully
// resolved (db/family-resolver.ts); the browser path finishes threading when a real session lands.
import { FAMILY_ID, type InboundRow } from "../db/schema.ts";
import { type GoogleOAuthDeps, registerOAuthRoutes } from "./oauth-routes/index.ts";
import { type RequireSessionConfig, requireSession } from "./session/index.ts";
import {
  extractMessages,
  type InboundMessage,
  verifyChallenge,
  verifySignature,
} from "./webhook.ts";

export interface ServerDeps {
  verifyToken: string;
  /** Durable inbound queue — dedupe + crash-safety live here, not in memory. */
  inbound: InboundStore;
  /** Persist-then-process one inbound (handler + queue settle). Injected so the server stays thin. */
  process: (msg: InboundMessage) => Promise<void>;
  /** Read model for GET /events (the family app's board read seam). */
  events: EventStore;
  /** #235 — read-only identity store backing GET /family (the roster the web app reads instead of the
   *  hardcoded KNOWN_ROSTER/HOUSEHOLD mocks). Scoped to FAMILY_ID server-side (N=1). */
  family: FamilyStore;
  /** #135 — family allowlist, used to FILTER the GET /messages feed: inbound_messages is persisted
   *  BEFORE the allowlist gate, so the raw table can hold non-family/spam text that must never be served. */
  allowlist: readonly string[];
  /** Meta app secret. When set, POST /webhook enforces the X-Hub-Signature-256 HMAC; unset = skip (test number). */
  appSecret?: string;
  /** Google OAuth deps (#16). Undefined ⇒ the OAuth routes ship dark (503). */
  google?: GoogleOAuthDeps;
  /**
   * #225 — session auth config gating the read/write routes (GET /events, /messages, POST/PATCH /events,
   * GET /oauth/google/status). Replaces the retired build-embedded readToken/writeToken/messagesToken with
   * a real per-user Supabase session (verified locally vs cached JWKS, allowlisted by email). Undefined ⇒
   * those routes are disabled (503): app-only deploys / dev / tests without Supabase configured.
   */
  session?: RequireSessionConfig;
  /** #150 — directory of the built web SPA (`apps/web/dist`), RELATIVE to the process cwd (the node
   *  serve-static driver rejects absolute roots). Undefined ⇒ no static serving (app-only / dev without a
   *  build / tests). When set, the SPA is served same-origin so the dashboard shares the API's origin. */
  webDist?: string;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** #135 — how many recent inbound rows the GET /messages feed returns (newest-first). */
const MESSAGES_FEED_LIMIT = 200;

/**
 * #135 — map a raw inbound queue row to the served {@link InboundMessageDTO}. `family_id` is pinned to
 * `FAMILY_ID` ("default") now — tenant-ready so D3's real column is purely additive (the served shape
 * won't change). `outcome` is a free `TEXT` column in SQLite but only ever a valid `InboundOutcome` or
 * null (written by `markDone`), so the narrowing cast is safe.
 */
function rowToInboundDTO(row: InboundRow): InboundMessageDTO {
  return {
    wa_message_id: row.wa_message_id,
    from_phone: row.from_phone,
    type: row.type,
    text: row.text,
    status: row.status,
    outcome: row.outcome as InboundMessageDTO["outcome"],
    received_at: row.received_at,
    processed_at: row.processed_at,
    family_id: FAMILY_ID,
  };
}

/**
 * The HomeOS WhatsApp webhook service. Routes:
 *   GET  /health   — liveness
 *   GET  /webhook  — Meta verification handshake (echo hub.challenge)
 *   POST /webhook  — inbound messages: ⚡ persist + dedupe, ack 200, then process async
 */
export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? (() => {});

  // #225 — the session gate shared by every read/write route. When session auth is configured it's the
  // `requireSession` middleware (real per-user Supabase session, allowlisted by email); when not, those
  // routes are disabled (503) — the app-only/dev/test path the retired readToken/writeToken expressed.
  const guard: MiddlewareHandler = deps.session
    ? requireSession(deps.session)
    : async (c) => c.text("Auth not configured", 503);

  app.get("/health", (c) => c.json({ status: "ok" }));

  // 🔌 Issue #16: Google OAuth connect/callback/disconnect. Always mounted; returns 503 when
  // `google` is undefined (app-only deploys). The status route is session-gated (#225) via `guard`.
  registerOAuthRoutes(app, deps.google, guard);

  // The read seam the family app consumes. #225 session-gated (`guard`); the events are
  // returned in the shared SavedEvent[] shape (incl. assignee/recurrence), ordered by date.
  app.get("/events", guard, (c) => {
    const events = [...deps.events.listEvents()].sort(
      (a, b) => a.date_iso.localeCompare(b.date_iso) || (a.time ?? "").localeCompare(b.time ?? ""),
    );
    return c.json({ events });
  });

  // #235 — the family roster read seam (the web app un-mocks KNOWN_ROSTER/HOUSEHOLD onto this). #225
  // session-gated (`guard`); FAMILY_ID-scoped server-side (N=1 — the browser→family resolver is deferred
  // to #226, like /events). Members carry the seeded display_name (the #14 config name, never the
  // placeholder user_id); a member with no name yet (a hypothetical future non-config row) degrades to "".
  // 404 when the family row is absent (no seed / unconfigured DB). Shape mirrors familyRosterResponseSchema.
  app.get("/family", guard, (c) => {
    const row = deps.family.getFamily(FAMILY_ID);
    if (row === null) return c.text("Not found", 404);
    const members = deps.family
      .listMembers(FAMILY_ID)
      .map((m) => ({ name: m.display_name ?? "", role: m.role }));
    return c.json({ family: { display_name: row.display_name }, members });
  });

  // #135 [D2] — the raw inbound-message feed (the "what did the bot receive + what happened" inbox),
  // complementary to GET /events. #225 session-gated (`guard`), and ALLOWLIST-FILTERED because
  // inbound_messages is persisted BEFORE the allowlist gate — the raw table can hold non-family/spam text
  // that must never be served. The filter is pushed into SQL (digit-normalized allowlist) so the cap applies
  // to family rows, not to a spam-padded window (F1). Each kept row maps to the served DTO (tenant-ready family_id).
  app.get("/messages", guard, (c) => {
    const allowed = deps.allowlist.map(normalizePhone);
    const messages = deps.inbound.listRecent(MESSAGES_FEED_LIMIT, allowed).map(rowToInboundDTO);
    return c.json({ messages });
  });

  // The app's write seam backing the client createEvent contract. #225 session-gated (`guard`) — an
  // allowlisted logged-in user. A manual add has no WhatsApp message, so synthesize a unique `web:<uuid>`
  // key and reuse saveEvent verbatim (sourceProvider omitted → source_provider null, calendar-pushable
  // like a forward). Returns the SINGLE SavedEvent (bare row, NOT {events}-wrapped) so the client's
  // savedEventSchema.parse of one row succeeds.
  app.post("/events", guard, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.text("Invalid JSON", 400);
    }
    const parsed = parsedEventSchema.safeParse(body);
    if (!parsed.success) return c.text("Invalid event", 400);
    const saved = deps.events.saveEvent(parsed.data, {
      fromPhone: "web",
      waMessageId: `web:${randomUUID()}`,
    });
    return c.json(saved, 201);
  });

  // #19 — the open/done toggle for a board task. The ONLY REST mutation of an existing row (title/date
  // edits stay handler-level over WhatsApp, #86). #225 session-gated (`guard`), like POST /events. 404 when
  // setEventStatus returns null — the row is synced (source_provider not null, never toggled) or doesn't
  // exist. Returns the updated single SavedEvent.
  app.patch("/events/:id", guard, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.text("Invalid id", 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.text("Invalid JSON", 400);
    }
    const parsed = eventStatusPatchSchema.safeParse(body);
    if (!parsed.success) return c.text("Invalid status", 400);
    const saved = deps.events.setEventStatus(id, parsed.data.status, FAMILY_ID);
    if (saved === null) return c.text("Not found", 404);
    return c.json(saved, 200);
  });

  app.get("/webhook", (c) => {
    const challenge = verifyChallenge(c.req.query(), deps.verifyToken);
    if (challenge === null) return c.text("Forbidden", 403);
    return c.text(challenge, 200);
  });

  app.post("/webhook", async (c) => {
    // Read the RAW body first — both for HMAC verification (must be the exact bytes Meta signed)
    // and to parse from the same string. c.req.json() would consume the body and re-serialize.
    const raw = await c.req.text();

    // 🔒 HMAC is MANDATORY: /webhook is a public, unauthenticated write surface, so a missing app key
    // OR a missing/forged X-Hub-Signature-256 is refused (403) BEFORE any persistence or processing —
    // fail closed, never silently accept unsigned (forgeable) inbound. Boot also refuses to start
    // without the key (see index.ts), so `appSecret === undefined` here is defence-in-depth.
    if (
      deps.appSecret === undefined ||
      !verifySignature(raw, c.req.header("x-hub-signature-256"), deps.appSecret)
    ) {
      log("rejected webhook: missing app key or invalid signature", {});
      return c.text("Forbidden", 403);
    }

    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null; // malformed body → no messages, still ack 200 (Meta retries non-200)
    }

    // ⚡ Persist-before-ack: each message is durably queued (and de-duped on wa_message_id)
    // BEFORE the 200, then processed off the ack path. A crash after the ack is recovered by
    // boot-replaying `pending` rows — Meta only retries non-2xx, so the queue is our safety net.
    for (const msg of extractMessages(body)) {
      if (!deps.inbound.enqueue(msg)) {
        log("skipped duplicate message", { id: msg.id });
        continue;
      }
      void deps.process(msg).catch((err: unknown) => {
        log("process failed", { id: msg.id, error: String(err) });
      });
    }

    return c.text("OK", 200);
  });

  // #150 — same-origin web app: serve the built SPA from `apps/web/dist`. Registered LAST so every API
  // route above wins (Hono runs handlers in registration order; the API routes respond without calling
  // next, so this middleware never shadows them). First mount serves real files (assets, /index.html);
  // serve-static calls next() on a miss, so the GET fallback then serves index.html for client-side
  // routes (/web/today, /phone/*, …) — standard SPA deep-link handling. Inert when `webDist` is unset.
  if (deps.webDist !== undefined) {
    const root = deps.webDist;
    app.use("/*", serveStatic({ root }));
    app.get("/*", serveStatic({ root, rewriteRequestPath: () => "/index.html" }));
  }

  return app;
}
