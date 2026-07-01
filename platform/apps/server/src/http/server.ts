import { randomUUID } from "node:crypto";
import {
  type BoundPhone,
  eventStatusPatchSchema,
  type InboundMessageDTO,
  type Invite,
  inviteRequestSchema,
  parsedEventSchema,
} from "@homeos/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { normalizePhone } from "../core/allowlist.ts";
import type { BindingStore } from "../db/binding-store.ts";
import type { EventStore } from "../db/event-store/index.ts";
import type { FamilyStore } from "../db/family-store.ts";
import type { InboundStore } from "../db/inbound-store.ts";
import type { InviteStore } from "../db/invite-store.ts";
// #226 — the browser read/write surface now scopes by the per-request `familyId` the session middleware
// resolves (`c.get("familyId")`): GET /family + setEventStatus. At N=1 it falls back to FAMILY_ID (no
// member row keyed by the real auth.uid yet), so behavior is unchanged. The events + messages feeds aren't
// family-keyed in the stores yet — that migration rides the multi-family/RLS work (so they keep the
// FAMILY_ID constant). The bot WRITE path — the chokepoint with no RLS backstop — resolves via
// db/family-resolver.ts.
import { FAMILY_ID, type FamilyPhoneRow, type InboundRow, type InviteRow } from "../db/schema.ts";
import { type CalendarToolDeps, pushSavedEventsToCalendar } from "../tools/index.ts";
import { type GoogleOAuthDeps, registerOAuthRoutes } from "./oauth-routes/index.ts";
import {
  type RequireSessionConfig,
  requireOwner,
  requireSession,
  requireWrite,
  type SessionVars,
} from "./session/index.ts";
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
  /** #231 (Slice B) — the human-readable WhatsApp bot number served by GET /channel (the connections page
   *  shows it). Undefined ⇒ the route returns `{ botPhone: null }` (the opaque PHONE_NUMBER_ID is NOT it). */
  botPhone?: string;
  /** #250 (Slice 2) — owner-issued invite store backing the POST/GET/DELETE /invites admin surface. Undefined
   *  ⇒ those routes return 503 (app-only/dev/tests without an invite store). Always present in prod. */
  invites?: InviteStore;
  /** #228 — phone-binding store backing POST /binding: issues the wa.me `HOME-XXXXX` code the web shows so a
   *  member can echo it to the bot (the WhatsApp echo half already runs in the inbound handler). Undefined ⇒
   *  the route returns 503 (app-only/dev/tests). Always present in prod (index.ts builds it). */
  bindings?: BindingStore;
  /** Meta app secret. When set, POST /webhook enforces the X-Hub-Signature-256 HMAC; unset = skip (test number). */
  appSecret?: string;
  /** Google OAuth deps (#16). Undefined ⇒ the OAuth routes ship dark (503). */
  google?: GoogleOAuthDeps;
  /** #18 — Calendar tool deps for auto-pushing app-created events (POST /events) to Google Calendar, the
   *  same seam the WhatsApp inbound handler uses. Undefined ⇒ app-only / not connected ⇒ no push. */
  calendar?: CalendarToolDeps;
  /** #18 — CALENDAR_AUTO_PUSH: gates the POST /events auto-push (paired with `calendar`). Undefined ⇒ no
   *  push (the env var itself defaults ON in config, so prod pushes unless explicitly disabled). */
  autoPushCalendar?: boolean;
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
 * #250 — the owner-facing invite view (the shared {@link Invite} contract). Deliberately OMITS the reserved
 * `token` (the future option-B shareable secret must never leave the server) and the `claimed_*` audit
 * columns. `status` is a free `TEXT` column but the store only ever writes a valid `InviteStatus`, so the
 * narrowing cast is safe (mirrors `rowToInboundDTO`'s `outcome` cast). The POST body is validated against the
 * shared `inviteRequestSchema` (imported, not re-declared) so the server route and the web client can't drift.
 */
function toInviteDTO(row: InviteRow): Invite {
  return {
    invite_id: row.invite_id,
    email: row.email,
    role: row.role,
    status: row.status as Invite["status"],
    invited_by: row.invited_by,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

/**
 * #262 — the owner-facing bound-phone view (the shared {@link BoundPhone} contract). Drops the internal
 * `family_id` (the route is already family-scoped, like the roster's omitted id) and serves the digit-
 * normalized `from_phone` + the bind timestamps so the owner can identify a sender to revoke.
 */
function toBoundPhoneDTO(row: FamilyPhoneRow): BoundPhone {
  return {
    from_phone: row.from_phone,
    verified_at: row.verified_at,
    created_at: row.created_at,
  };
}

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
    const familyId = (c.var as SessionVars).familyId;
    const row = deps.family.getFamily(familyId);
    if (row === null) return c.text("Not found", 404);
    const members = deps.family
      .listMembers(familyId)
      .map((m) => ({ name: m.display_name ?? "", role: m.role }));
    // #266 — WhatsApp connectivity is now a FAMILY-level signal (was a per-member `verified` flag, retired):
    // family_phones is family-scoped, so "is a number bound to this home?" is the honest question. The
    // connections page renders it; a per-member badge needs a real uid↔phone binding (deferred to N>1).
    const whatsappConnected = deps.family.listPhones(familyId).length > 0;
    return c.json({ family: { display_name: row.display_name, whatsappConnected }, members });
  });

  // #231 (Slice B) — the WhatsApp channel's human-readable bot number for the connections page. Session-gated
  // (`guard`) like /family; `botPhone` is null when BOT_PHONE_NUMBER is unset (the opaque PHONE_NUMBER_ID is
  // a Meta id, not a dialable number) → the web shows a neutral fallback rather than a fake number.
  app.get("/channel", guard, (c) => {
    return c.json({ botPhone: deps.botPhone ?? null });
  });

  // #250 (Slice 2) — owner-only, family-scoped self-serve invite admin. Minting an invite GRANTS admission
  // (the invitee's next Google login claims it inside requireSession), so the surface is gated by
  // requireOwner() — strictly narrower than the writer gate. All three routes scope to the session's resolved
  // familyId, so an owner can only ever touch their own family's invites. 503 when the invite store is unwired
  // (app-only/dev), mirroring `guard`'s posture for an unconfigured dependency.
  app.post("/invites", guard, requireOwner(), async (c) => {
    if (!deps.invites) return c.text("Invites not configured", 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.text("Invalid JSON", 400);
    }
    const parsed = inviteRequestSchema.safeParse(body);
    if (!parsed.success) return c.text("Invalid invite", 400);
    const invite = deps.invites.createInvite({
      familyId: (c.var as SessionVars).familyId,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: (c.var as SessionVars).email, // audit: which owner minted it
    });
    return c.json({ invite: toInviteDTO(invite) }, 201);
  });

  // The owner's pending-invite list (drives the 2b web admin view). Pending + unexpired only, family-scoped.
  app.get("/invites", guard, requireOwner(), (c) => {
    if (!deps.invites) return c.text("Invites not configured", 503);
    const invites = deps.invites.listPending((c.var as SessionVars).familyId).map(toInviteDTO);
    return c.json({ invites });
  });

  // Owner-revoke a pending invite. Family-scoped in the store, so a foreign / unknown id matches nothing → 404
  // (never a cross-family revoke). 204 No Content on success.
  app.delete("/invites/:id", guard, requireOwner(), (c) => {
    if (!deps.invites) return c.text("Invites not configured", 503);
    const revoked = deps.invites.revokeInvite(c.req.param("id"), (c.var as SessionVars).familyId);
    if (!revoked) return c.text("Not found", 404);
    return c.body(null, 204);
  });

  // #262 — owner-only, family-scoped WhatsApp-sender revocation. Since #259 made `family_phones` the SOLE
  // bot admission gate, dropping a number from the ALLOWLIST env no longer de-authorizes a bound sender —
  // this is the admin path that does. Rides the same requireOwner() surface as invite-revoke; `family` is
  // always wired (no 503 case, unlike the optional invite store). Raw household numbers are owner-only PII.
  app.get("/phones", guard, requireOwner(), (c) => {
    const phones = deps.family.listPhones((c.var as SessionVars).familyId).map(toBoundPhoneDTO);
    return c.json({ phones });
  });

  // Unbind a sender. `unbindPhone` is family-scoped + normalizes the path phone, so a foreign / unknown /
  // already-unbound number matches nothing → 404 (never a cross-family revoke). 204 on success; the next
  // inbound forward from that phone is then refused by the resolver gate with no write.
  app.delete("/phones/:phone", guard, requireOwner(), (c) => {
    const unbound = deps.family.unbindPhone((c.var as SessionVars).familyId, c.req.param("phone"));
    if (!unbound) return c.text("Not found", 404);
    return c.body(null, 204);
  });

  // #228 — mint a wa.me binding code for the logged-in member's OWN family. Session-gated (`guard`) and
  // requireWrite() — binding a WhatsApp sender enables forwarding events, a writer capability (a read-only
  // viewer has no reason to bind). NOT owner-only: any writer self-binds their own number. The code is
  // scoped to the session's resolved familyId, so a member can only ever mint a code for their own family;
  // the durable cross-tenant proof is still the WhatsApp echo (`matchBinding`), never this issue call. 503
  // when the binding store is unwired (app-only/dev), mirroring the invite-route posture.
  app.post("/binding", guard, requireWrite(), (c) => {
    if (!deps.bindings) return c.text("Binding not configured", 503);
    const code = deps.bindings.issueBinding((c.var as SessionVars).familyId);
    return c.json({ code }, 201);
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
  app.post("/events", guard, requireWrite(), async (c) => {
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
    // #18 — auto-push the new board event to Google Calendar, the SAME seam the WhatsApp inbound handler
    // uses (parse-and-confirm.ts). FIRE-AND-FORGET (not awaited): like the bot path confirms BEFORE pushing,
    // we return the 201 first so the (non-optimistic) Add-Event dialog isn't blocked on two Google round-trips.
    // The helper is best-effort by contract — it swallows token/write errors and never throws, so the floating
    // promise can't reject. The board is the source of truth; only source_provider-null rows are written (a
    // manual add qualifies). Scoped to the session's resolved familyId.
    if (deps.autoPushCalendar && deps.calendar) {
      const familyId = (c.var as SessionVars).familyId;
      void pushSavedEventsToCalendar([saved], deps.calendar, familyId, deps.log).then(
        ({ pushed }) => {
          if (pushed > 0) deps.log?.("auto-pushed web event to calendar", { id: saved.id, pushed });
        },
      );
    }
    return c.json(saved, 201);
  });

  // #19 — the open/done toggle for a board task. The ONLY REST mutation of an existing row (title/date
  // edits stay handler-level over WhatsApp, #86). #225 session-gated (`guard`), like POST /events. 404 when
  // setEventStatus returns null — the row is synced (source_provider not null, never toggled) or doesn't
  // exist. Returns the updated single SavedEvent.
  app.patch("/events/:id", guard, requireWrite(), async (c) => {
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
    const saved = deps.events.setEventStatus(
      id,
      parsed.data.status,
      (c.var as SessionVars).familyId,
    );
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
