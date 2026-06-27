import { randomUUID } from "node:crypto";
import { eventStatusPatchSchema, type InboundMessageDTO, parsedEventSchema } from "@homeos/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { normalizePhone } from "../core/allowlist.ts";
import type { EventStore } from "../db/event-store/index.ts";
import type { InboundStore } from "../db/inbound-store.ts";
// #229 — the web read/write surface (served DTO family_id, setEventStatus) still uses the single-family
// FAMILY_ID. DEFERRED with the OAuth path (see oauth-routes/): it resolves via the session identity,
// which doesn't exist until #226. The bot WRITE path — the chokepoint with no RLS backstop — is fully
// resolved (db/family-resolver.ts); the browser path finishes threading when a real session lands.
import { FAMILY_ID, type InboundRow } from "../db/schema.ts";
import { bearerMatches } from "./auth.ts";
import { type GoogleOAuthDeps, registerOAuthRoutes } from "./oauth-routes/index.ts";
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
  /** #135 — family allowlist, used to FILTER the GET /messages feed: inbound_messages is persisted
   *  BEFORE the allowlist gate, so the raw table can hold non-family/spam text that must never be served. */
  allowlist: readonly string[];
  /** Bearer token gating GET /events. When undefined the endpoint is disabled (503). */
  readToken?: string;
  /** #135 — Bearer token gating GET /messages (the raw inbound feed). Undefined ⇒ disabled (503). A
   *  DISTINCT credential from the read token — never falls back to it: the raw feed can carry other
   *  people's words / pre-allowlist text, so a client holding only READ_TOKEN must not reach it. */
  messagesToken?: string;
  /** Meta app secret. When set, POST /webhook enforces the X-Hub-Signature-256 HMAC; unset = skip (test number). */
  appSecret?: string;
  /** Google OAuth deps (#16). Undefined ⇒ the OAuth routes ship dark (503). */
  google?: GoogleOAuthDeps;
  /** Bearer token gating POST /events (the web/phone write seam). Undefined ⇒ disabled (503). A
   *  DISTINCT credential from the read token — never falls back to it (a read-only deploy can't mutate). */
  writeToken?: string;
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

  app.get("/health", (c) => c.json({ status: "ok" }));

  // 🔌 Issue #16: Google OAuth connect/callback/disconnect. Always mounted; returns 503 when
  // `google` is undefined (app-only deploys), exactly like the GET /events read seam.
  registerOAuthRoutes(app, deps.google);

  // The read seam the family app consumes. Token-gated; the events are
  // returned in the shared SavedEvent[] shape (incl. assignee/recurrence), ordered by date.
  app.get("/events", (c) => {
    if (deps.readToken === undefined) return c.text("Read API disabled", 503);
    if (!bearerMatches(c.req.header("authorization"), deps.readToken)) {
      return c.text("Unauthorized", 401);
    }
    const events = [...deps.events.listEvents()].sort(
      (a, b) => a.date_iso.localeCompare(b.date_iso) || (a.time ?? "").localeCompare(b.time ?? ""),
    );
    return c.json({ events });
  });

  // #135 [D2] — the raw inbound-message feed (the "what did the bot receive + what happened" inbox),
  // complementary to GET /events. Gated by a DISTINCT messages token (never the read token) so a
  // read-token-only client can't fetch it, and ALLOWLIST-FILTERED because inbound_messages is persisted
  // BEFORE the allowlist gate — the raw table can hold non-family/spam text that must never be served. The
  // filter is pushed into SQL (digit-normalized allowlist) so the cap applies to family rows, not to a
  // spam-padded window (F1). Each kept row maps to the served DTO (tenant-ready family_id).
  app.get("/messages", (c) => {
    if (deps.messagesToken === undefined) return c.text("Messages API disabled", 503);
    if (!bearerMatches(c.req.header("authorization"), deps.messagesToken)) {
      return c.text("Unauthorized", 401);
    }
    const allowed = deps.allowlist.map(normalizePhone);
    const messages = deps.inbound.listRecent(MESSAGES_FEED_LIMIT, allowed).map(rowToInboundDTO);
    return c.json({ messages });
  });

  // The app's write seam backing the client createEvent contract. Gated by a DISTINCT write token
  // (never the read token) so a read-only client can't mutate. A manual add has no WhatsApp message,
  // so synthesize a unique `web:<uuid>` key and reuse saveEvent verbatim (sourceProvider omitted →
  // source_provider null, calendar-pushable like a forward). Returns the SINGLE SavedEvent (bare row,
  // NOT {events}-wrapped) so the client's savedEventSchema.parse of one row succeeds.
  app.post("/events", async (c) => {
    if (deps.writeToken === undefined) return c.text("Write API disabled", 503);
    if (!bearerMatches(c.req.header("authorization"), deps.writeToken)) {
      return c.text("Unauthorized", 401);
    }
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
  // edits stay handler-level over WhatsApp, #86). Gated by the SAME write token as POST /events (a board
  // mutation from the authenticated app). 404 when setEventStatus returns null — the row is synced
  // (source_provider not null, never toggled) or doesn't exist. Returns the updated single SavedEvent.
  app.patch("/events/:id", async (c) => {
    if (deps.writeToken === undefined) return c.text("Write API disabled", 503);
    if (!bearerMatches(c.req.header("authorization"), deps.writeToken)) {
      return c.text("Unauthorized", 401);
    }
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
