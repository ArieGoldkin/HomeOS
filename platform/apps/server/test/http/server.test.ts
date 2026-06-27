import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { SavedEvent } from "@homeos/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { InboundRow } from "../../src/db/schema.ts";
import type { ServerDeps } from "../../src/http/server.ts";
import { createServer } from "../../src/http/server.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import { type JwtKit, makeJwtKit } from "./session/jwt-test-kit.ts";

// #135 — the test allowlist for the GET /messages filter (inbound_messages is persisted pre-allowlist).
const MSG_ALLOWLIST = ["972500000001"];

// #225 — the shared ES256 JWT kit: mints session tokens verified offline (local JWKS, no network). The
// default token email is "dad@example.com"; sessionConfig(["dad@example.com"]) is the gate makeApp wires.
let kit: JwtKit;
beforeAll(async () => {
  kit = await makeJwtKit();
});

const textPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1", phone_number_id: "P" },
            messages: [
              {
                from: "972501234567",
                id: "wamid.1",
                timestamp: "1",
                type: "text",
                text: { body: "שלום" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const sampleEvents = [
  {
    id: 2,
    kind: "event" as const,
    title_he: "טיול",
    date_iso: "2026-06-25",
    time: null,
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "טיול",
    source_provider: null,
  },
  {
    id: 1,
    kind: "event" as const,
    title_he: "אסיפת הורים",
    date_iso: "2026-06-21",
    time: "18:30",
    location: "גן רימון",
    assignee: "אבא",
    recurrence: { freq: "weekly" as const, weekday: 0 },
    source_text: "אסיפת הורים",
    source_provider: null,
  },
];

// Default webhook HMAC key for tests (named "key" to stay clear of the repo's secret scanner).
// HMAC is now mandatory, so makeApp() always wires one unless a test explicitly forces it undefined.
const appKey = "homeos-webhook-test-key";

function makeApp(
  opts: {
    appSecret?: string;
    webDist?: string;
    /** #225 — false ⇒ leave deps.session undefined so the gated routes return 503 (auth not configured). */
    session?: boolean;
    /** #225 — the allowlist the session gate enforces; defaults to the kit's default token email. */
    allowed?: string[];
  } = {
    appSecret: appKey,
  },
) {
  const process = vi.fn(async (_msg: InboundMessage) => {});
  // Inbound queue stand-in: dedupes on id like the real PRIMARY KEY does.
  const seen = new Set<string>();
  const inbound = {
    enqueue: vi.fn((msg: InboundMessage) => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    }),
    markDone: vi.fn(),
    markFailed: vi.fn(),
    pending: vi.fn(() => [] as InboundMessage[]),
    listRecent: vi.fn((): InboundRow[] => []),
    statsSince: vi.fn(() => ({ done: 0, failed: 0, pending: 0 })),
    countFromSenderSince: vi.fn(() => 0),
  };
  const events = {
    // Echo the parsed event back as a SavedEvent (DB assigns id; source_provider null for a manual add).
    // Two params so the call tuple types as [event, meta] — the POST test asserts the synthetic web meta.
    saveEvent: vi.fn((ev, _meta) => ({ ...ev, id: 7, source_provider: null })),
    listEvents: vi.fn(() => sampleEvents),
    deleteLastFromSender: vi.fn(() => 0),
    countSince: vi.fn(() => 0),
    deleteByProvider: vi.fn(() => 0),
    deleteById: vi.fn(() => 1),
    findEventsByRef: vi.fn(() => []),
    searchEvents: vi.fn(() => []),
    findEventsInScope: vi.fn(() => []),
    remindersDueOn: vi.fn(() => []),
    updateEvent: vi.fn(() => null),
    setEventStatus: vi.fn(
      (id: number, status: string): SavedEvent | null =>
        ({ ...sampleEvents[0], id, status }) as unknown as SavedEvent,
    ),
    findSlotConflict: vi.fn(() => null),
  };
  const deps: ServerDeps = {
    verifyToken: "secret",
    inbound,
    process,
    events,
    allowlist: MSG_ALLOWLIST,
    appSecret: opts.appSecret,
  };
  // #225 — the per-user session gate, built into a neutral-named local first (mirrors the prior msgCred
  // shape) so the secret scanner doesn't read it as a same-name credential. `session === false` opts out
  // → deps.session stays undefined → the gated routes return 503 (the dev/app-only path the retired
  // build-embedded tokens expressed).
  const gate =
    opts.session === false ? undefined : kit.sessionConfig(opts.allowed ?? ["dad@example.com"]);
  deps.session = gate;
  deps.webDist = opts.webDist;
  return { app: createServer(deps), process, inbound, events };
}

function post(
  app: ReturnType<typeof makeApp>["app"],
  body: string,
  extraHeaders: Record<string, string> = {},
) {
  // HMAC is mandatory, so sign with the default test key unless the caller supplied a signature
  // (the forged / missing-signature cases pass their own header or hit app.request directly).
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (!("X-Hub-Signature-256" in headers)) {
    headers["X-Hub-Signature-256"] = sign(body, appKey);
  }
  return app.request("/webhook", { method: "POST", headers, body });
}

/** Compute the X-Hub-Signature-256 header Meta would send for a body. */
function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("GET /webhook (verification)", () => {
  it("echoes hub.challenge when the token matches", async () => {
    const { app } = makeApp();
    const res = await app.request(
      "/webhook?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=12345",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("returns 403 on token mismatch", async () => {
    const { app } = makeApp();
    const res = await app.request(
      "/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345",
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /webhook (inbound)", () => {
  it("acks 200 immediately, enqueues, then dispatches processing off the ack path", async () => {
    const { app, inbound, process } = makeApp();
    const res = await post(app, JSON.stringify(textPayload));
    expect(res.status).toBe(200); // ⚡ ack first, regardless of processing
    expect(inbound.enqueue).toHaveBeenCalledTimes(1); // persisted BEFORE the ack
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    const [msg] = process.mock.calls[0]!;
    expect(msg).toMatchObject({ id: "wamid.1", from: "972501234567", text: "שלום" });
  });

  it("processes a duplicate delivery only once (queue dedupe before ack)", async () => {
    const { app, process } = makeApp();
    await post(app, JSON.stringify(textPayload));
    await post(app, JSON.stringify(textPayload)); // Meta at-least-once retry
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
  });

  it("acks 200 for a status-only webhook (no messages) and dispatches nothing", async () => {
    const { app, process } = makeApp();
    const res = await post(app, JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    expect(res.status).toBe(200);
    expect(process).not.toHaveBeenCalled();
  });

  it("acks 200 even on a malformed JSON body", async () => {
    const { app } = makeApp();
    const res = await post(app, "{not json");
    expect(res.status).toBe(200);
  });
});

describe("POST /webhook signature (HMAC, item H — mandatory)", () => {
  const secret = "meta-app-secret";
  const payload = JSON.stringify(textPayload);

  it("processes a correctly-signed payload when an app secret is configured", async () => {
    const { app, inbound } = makeApp({ appSecret: secret });
    const res = await post(app, payload, { "X-Hub-Signature-256": sign(payload, secret) });
    expect(res.status).toBe(200);
    expect(inbound.enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged/unsigned payload with 403 and does not process it", async () => {
    const { app, inbound } = makeApp({ appSecret: secret });
    const bad = await post(app, payload, { "X-Hub-Signature-256": "sha256=deadbeef" });
    expect(bad.status).toBe(403);
    const missing = await post(app, payload); // no signature header
    expect(missing.status).toBe(403);
    expect(inbound.enqueue).not.toHaveBeenCalled();
  });

  it("fails closed: rejects with 403 when no app key is configured", async () => {
    const { app, inbound } = makeApp({}); // empty opts → no app key wired
    const res = await post(app, payload); // auto-signed, but the server has no key to verify against
    expect(res.status).toBe(403);
    expect(inbound.enqueue).not.toHaveBeenCalled();
  });
});

describe("GET /events (read seam)", () => {
  it("returns events as JSON (date-ordered, full shape) with a valid session token", async () => {
    const { app } = makeApp();
    const res = await app.request("/events", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ title_he: string; assignee: string | null }>;
    };
    expect(body.events).toHaveLength(2);
    expect(body.events[0]!.title_he).toBe("אסיפת הורים"); // 06-21 sorts before 06-25
    expect(body.events[0]!.assignee).toBe("אבא"); // assignee + recurrence surfaced
  });

  it("returns 401 without a token or with an invalid one", async () => {
    const { app } = makeApp();
    expect((await app.request("/events")).status).toBe(401);
    const wrong = await app.request("/events", { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  it("returns 403 for a valid session whose email is not allowlisted", async () => {
    const { app } = makeApp();
    const res = await app.request("/events", {
      headers: { Authorization: `Bearer ${await kit.sign({ email: "stranger@example.com" })}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 503 when session auth is not configured (endpoint disabled)", async () => {
    const { app } = makeApp({ session: false });
    const res = await app.request("/events", { headers: { Authorization: "Bearer anything" } });
    expect(res.status).toBe(503);
  });
});

describe("GET /messages (raw inbound feed)", () => {
  // One already-allowlist-filtered row (the store does the WHERE from_phone IN (…) filtering — see the
  // inbound-store tests; the endpoint only delegates + maps to the DTO).
  const familyRow: InboundRow = {
    wa_message_id: "wamid.fam",
    from_phone: "972500000001",
    type: "text",
    text: "פגישה מחר",
    status: "done",
    received_at: "2026-06-22 07:00:00",
    processed_at: "2026-06-22 07:00:01",
    outcome: "parsed",
  };

  it("503 when session auth is not configured (endpoint disabled)", async () => {
    const { app } = makeApp({ session: false });
    const res = await app.request("/messages", { headers: { Authorization: "Bearer anything" } });
    expect(res.status).toBe(503);
  });

  it("401 on a missing or invalid token", async () => {
    const { app } = makeApp();
    expect((await app.request("/messages")).status).toBe(401);
    const wrong = await app.request("/messages", { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  // THE privacy line is now the session+allowlist gate: a logged-in but non-family account is refused.
  it("403 for a valid session whose email is not allowlisted (never unlocks the raw feed)", async () => {
    const { app } = makeApp();
    const res = await app.request("/messages", {
      headers: { Authorization: `Bearer ${await kit.sign({ email: "stranger@example.com" })}` },
    });
    expect(res.status).toBe(403);
  });

  it("200 serves the wrapped { messages } DTO and delegates allowlist filtering to the store", async () => {
    const { app, inbound } = makeApp();
    inbound.listRecent.mockReturnValue([familyRow]); // the store already applied the allowlist + cap
    const res = await app.request("/messages", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: Array<{ wa_message_id: string; family_id: string; outcome: string | null }>;
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.wa_message_id).toBe("wamid.fam");
    expect(body.messages[0]!.family_id).toBe("default"); // tenant-ready DTO (D3-additive)
    expect(body.messages[0]!.outcome).toBe("parsed");
    // F1 — the endpoint pushes the digit-normalized allowlist into the store so LIMIT applies post-filter.
    expect(inbound.listRecent).toHaveBeenCalledWith(expect.any(Number), ["972500000001"]);
  });
});

describe("POST /events (write seam)", () => {
  const validParsed = {
    kind: "event" as const,
    title_he: "ארוחת ערב",
    date_iso: "2026-06-25",
    time: "19:00",
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "ארוחת ערב",
  };

  function postEvents(
    app: ReturnType<typeof makeApp>["app"],
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it("returns 503 when session auth is not configured (writes off by default)", async () => {
    const { app, events } = makeApp({ session: false });
    const res = await postEvents(app, validParsed, auth("anything"));
    expect(res.status).toBe(503);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("returns 401 without a token or with an invalid one", async () => {
    const { app, events } = makeApp();
    expect((await postEvents(app, validParsed)).status).toBe(401);
    expect((await postEvents(app, validParsed, auth("nope"))).status).toBe(401);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("returns 403 for a valid session whose email is not allowlisted", async () => {
    const { app, events } = makeApp();
    const stranger = await kit.sign({ email: "stranger@example.com" });
    const res = await postEvents(app, validParsed, auth(stranger));
    expect(res.status).toBe(403);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("returns 400 on a body that fails parsedEventSchema", async () => {
    const { app, events } = makeApp();
    const res = await postEvents(app, { kind: "nope", title_he: "" }, auth(await kit.sign()));
    expect(res.status).toBe(400);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body", async () => {
    const { app } = makeApp();
    const res = await postEvents(app, "{not json", auth(await kit.sign()));
    expect(res.status).toBe(400);
  });

  it("persists a valid event (synthetic web meta) and returns the single SavedEvent — 201, NOT {events}-wrapped", async () => {
    const { app, events } = makeApp();
    const res = await postEvents(app, validParsed, auth(await kit.sign()));
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown> & { events?: unknown };
    expect(body.events).toBeUndefined(); // a bare SavedEvent row, NOT the GET /events {events} envelope
    expect(body).toMatchObject({
      id: 7,
      kind: "event",
      title_he: "ארוחת ערב",
      source_provider: null,
    });

    expect(events.saveEvent).toHaveBeenCalledTimes(1);
    const [parsedArg, metaArg] = events.saveEvent.mock.calls[0]!;
    expect(parsedArg).toMatchObject({
      kind: "event",
      title_he: "ארוחת ערב",
      date_iso: "2026-06-25",
    });
    expect(metaArg).toMatchObject({ fromPhone: "web" });
    expect(String(metaArg.waMessageId)).toMatch(/^web:/); // synthetic + unique per request
  });
});

describe("PATCH /events/:id (status toggle, #19)", () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  function patchStatus(
    app: ReturnType<typeof makeApp>["app"],
    id: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.request(`/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("returns 503 when session auth is not configured", async () => {
    const { app, events } = makeApp({ session: false });
    expect((await patchStatus(app, "7", { status: "done" }, auth("x"))).status).toBe(503);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 401 without a token or with an invalid one", async () => {
    const { app, events } = makeApp();
    expect((await patchStatus(app, "7", { status: "done" })).status).toBe(401);
    expect((await patchStatus(app, "7", { status: "done" }, auth("nope"))).status).toBe(401);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 403 for a valid session whose email is not allowlisted", async () => {
    const { app, events } = makeApp();
    const stranger = await kit.sign({ email: "stranger@example.com" });
    expect((await patchStatus(app, "7", { status: "done" }, auth(stranger))).status).toBe(403);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-integer id", async () => {
    const { app, events } = makeApp();
    expect((await patchStatus(app, "abc", { status: "done" }, auth(await kit.sign()))).status).toBe(
      400,
    );
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid status body and on malformed JSON", async () => {
    const { app, events } = makeApp();
    const t = await kit.sign();
    expect((await patchStatus(app, "7", { status: "archived" }, auth(t))).status).toBe(400);
    expect((await patchStatus(app, "7", "{not json", auth(t))).status).toBe(400);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("returns 404 when the row isn't a board row (setEventStatus → null)", async () => {
    const { app, events } = makeApp();
    events.setEventStatus.mockReturnValueOnce(null);
    expect((await patchStatus(app, "999", { status: "done" }, auth(await kit.sign()))).status).toBe(
      404,
    );
  });

  it("toggles a board row and returns the updated single SavedEvent (200)", async () => {
    const { app, events } = makeApp();
    const res = await patchStatus(app, "7", { status: "done" }, auth(await kit.sign()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { events?: unknown };
    expect(body.events).toBeUndefined(); // a bare row, not the {events} envelope
    expect(body).toMatchObject({ id: 7, status: "done" });
    expect(events.setEventStatus).toHaveBeenCalledWith(7, "done", "default");
  });
});

describe("GET /health", () => {
  it("reports ok", async () => {
    const { app } = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

// #150 — same-origin web app. serve-static reads the real filesystem (root is cwd-relative), so we
// stand up a tiny fixture dist with an index.html + an asset and point webDist at it.
describe("static web app serving (#150)", () => {
  let webDist: string;
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "homeos-web-"));
    mkdirSync(join(tmp, "assets"), { recursive: true });
    writeFileSync(
      join(tmp, "index.html"),
      "<!doctype html><title>HomeOS</title><div id=root></div>",
    );
    writeFileSync(join(tmp, "assets", "app.js"), "console.log('homeos')");
    webDist = relative(process.cwd(), tmp); // serve-static rejects absolute roots → pass cwd-relative
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("serves index.html at /", async () => {
    const { app } = makeApp({ appSecret: appKey, webDist });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("HomeOS");
  });

  it("serves a built asset", async () => {
    const { app } = makeApp({ appSecret: appKey, webDist });
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("homeos");
  });

  it("falls back to index.html for an unknown client route (SPA deep-link)", async () => {
    const { app } = makeApp({ appSecret: appKey, webDist });
    const res = await app.request("/web/today");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("HomeOS"); // not a 404 — the SPA handles the route client-side
  });

  it("API routes still win over the static catch-all", async () => {
    const { app } = makeApp({ appSecret: appKey, webDist });
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/events")).status).toBe(401); // API handler (no token), NOT the SPA fallback
  });

  it("no static serving when webDist is unset (app-only / dev)", async () => {
    const { app } = makeApp({ appSecret: appKey });
    expect((await app.request("/web/today")).status).toBe(404); // nothing serves it
  });
});
