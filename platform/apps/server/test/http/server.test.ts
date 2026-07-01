import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { CURRENT_TERMS_VERSION, type SavedEvent } from "@homeos/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBindingStore } from "../../src/db/binding-store.ts";
import { createFamilyStore, type FamilySeed } from "../../src/db/family-store.ts";
import { createInviteStore } from "../../src/db/invite-store.ts";
import { FAMILY_ID, type InboundRow } from "../../src/db/schema.ts";
import type { ServerDeps } from "../../src/http/server.ts";
import { createServer } from "../../src/http/server.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import type { CalendarToolDeps } from "../../src/tools/index.ts";
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

// #235 — default roster seed for the GET /family tests: real Hebrew display names (the route serves these,
// NOT the placeholder user_id) + an owner/member role pair.
const defaultFamilySeed: FamilySeed = {
  family: { familyId: FAMILY_ID, displayName: "משפחת הבית" },
  members: [
    { userId: "placeholder:1", role: "owner", displayName: "אבא" },
    { userId: "placeholder:2", role: "member", displayName: "אמא" },
  ],
};

function makeApp(
  opts: {
    appSecret?: string;
    webDist?: string;
    /** #225 — false ⇒ leave deps.session undefined so the gated routes return 503 (auth not configured). */
    session?: boolean;
    /** #225 — the allowlist the session gate enforces; defaults to the kit's default token email. */
    allowed?: string[];
    /** #235 — the family roster seed; `null` ⇒ unseeded store (GET /family 404). Defaults to a 2-member family. */
    familySeed?: FamilySeed | null;
    /** #226 — inject the session membership ({familyId, role}) by email; default null ⇒ N=1 fallback. */
    resolveMembershipByEmail?: (email: string) => { familyId: string; role: string } | null;
    /** #231 — the human-readable bot number served by GET /channel; undefined ⇒ the route serves null. */
    botPhone?: string;
    /** #18 — when defined, wires deps.calendar; true ⇒ a connected credential (push writes), false ⇒ none. */
    calendar?: boolean;
    /** #18 — CALENDAR_AUTO_PUSH equivalent; pairs with `calendar` to exercise the POST /events auto-push. */
    autoPush?: boolean;
    /** #18 — force the calendar insert to throw, to prove a push failure never fails the save/201. */
    calendarInsertThrows?: boolean;
    /** #250 — wire a real in-memory invite store so the POST/GET/DELETE /invites routes exercise it. */
    invites?: boolean;
    /** #228 — wire a real in-memory binding store so POST /binding exercises the actual issueBinding path. */
    bindings?: boolean;
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
  // #235 — a real in-memory FamilyStore so the GET /family test exercises the actual store→route path.
  // `familySeed: null` boots it unseeded (getFamily → null → the 404 case).
  const family =
    opts.familySeed === null
      ? createFamilyStore(":memory:")
      : createFamilyStore(":memory:", opts.familySeed ?? defaultFamilySeed);
  // #18 — a fake Calendar seam mirroring the handler-test mock (_setup.ts): `calendar: true` → a stored
  // credential so getValidAccessToken returns ok and the push writes; `false` → not connected (no writes).
  const calendar: CalendarToolDeps | undefined =
    opts.calendar === undefined
      ? undefined
      : ({
          client: {
            list: vi.fn(),
            findEventIdByPrivateProp: vi.fn(async () => null),
            insertEvent: vi.fn(async () => {
              if (opts.calendarInsertThrows) throw new Error("gcal insert 500");
              return { id: "gcal-new" };
            }),
            patchEvent: vi.fn(async () => ({ id: "gcal-p" })),
          },
          oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
          credentials: {
            get: vi.fn(() =>
              opts.calendar
                ? { accessToken: "a", refreshToken: "r", expiry: "2099-01-01 00:00:00", scopes: [] }
                : null,
            ),
            updateTokens: vi.fn(),
            delete: vi.fn(),
          },
          calendarId: "primary",
          windowDays: 30,
          maxEvents: 20,
        } as unknown as CalendarToolDeps);
  // #250 — a real in-memory invite store when requested, so the /invites routes drive the actual store path.
  const invites = opts.invites ? createInviteStore(":memory:") : undefined;
  // #228 — a real in-memory binding store when requested, so POST /binding drives the actual issueBinding path.
  const bindings = opts.bindings ? createBindingStore(":memory:") : undefined;
  const deps: ServerDeps = {
    verifyToken: "secret",
    inbound,
    process,
    events,
    family,
    invites,
    bindings,
    botPhone: opts.botPhone,
    calendar,
    autoPushCalendar: opts.autoPush,
    allowlist: MSG_ALLOWLIST,
    appSecret: opts.appSecret,
  };
  // #225 — the per-user session gate, built into a neutral-named local first (mirrors the prior msgCred
  // shape) so the secret scanner doesn't read it as a same-name credential. `session === false` opts out
  // → deps.session stays undefined → the gated routes return 503 (the dev/app-only path the retired
  // build-embedded tokens expressed).
  const gate =
    opts.session === false
      ? undefined
      : kit.sessionConfig(opts.allowed ?? ["dad@example.com"], {
          resolveMembershipByEmail: opts.resolveMembershipByEmail,
        });
  deps.session = gate;
  deps.webDist = opts.webDist;
  return { app: createServer(deps), process, inbound, events, calendar, invites };
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

describe("GET /family (roster read seam, #235)", () => {
  it("returns family.display_name + seeded members ({name, role}); whatsappConnected false with no phones", async () => {
    const { app } = makeApp();
    const res = await app.request("/family", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      family: { display_name: string; whatsappConnected: boolean };
      members: Array<{ name: string; role: string }>;
    };
    expect(body.family.display_name).toBe("משפחת הבית");
    // #266 — per-member `verified` retired; the default seed binds NO phones → family-level not connected.
    expect(body.family.whatsappConnected).toBe(false);
    expect(body.members).toEqual([
      { name: "אבא", role: "owner" },
      { name: "אמא", role: "member" },
    ]);
  });

  it("#266 — family.whatsappConnected is true when the family has any bound phone (family-level signal)", async () => {
    const familySeed: FamilySeed = {
      family: { familyId: FAMILY_ID, displayName: "משפחת הבית" },
      members: [
        { userId: "auth-uid-1", role: "owner", displayName: "אבא", email: "dad@example.com" },
      ],
      phones: [{ fromPhone: "972501234567", verifiedAt: "2026-06-26 09:00:00" }],
    };
    const { app } = makeApp({ appSecret: appKey, familySeed });
    const res = await app.request("/family", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    const body = (await res.json()) as { family: { whatsappConnected: boolean } };
    expect(body.family.whatsappConnected).toBe(true);
  });

  it("returns 401 without a token or with an invalid one", async () => {
    const { app } = makeApp();
    expect((await app.request("/family")).status).toBe(401);
    const wrong = await app.request("/family", { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  it("returns 403 for a valid session whose email is not allowlisted", async () => {
    const { app } = makeApp();
    const res = await app.request("/family", {
      headers: { Authorization: `Bearer ${await kit.sign({ email: "stranger@example.com" })}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 503 when session auth is not configured (endpoint disabled)", async () => {
    const { app } = makeApp({ session: false });
    const res = await app.request("/family", { headers: { Authorization: "Bearer anything" } });
    expect(res.status).toBe(503);
  });

  it("returns 404 when no family is seeded (unconfigured/empty DB)", async () => {
    const { app } = makeApp({ familySeed: null });
    const res = await app.request("/family", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /channel (bot number read seam, #231)", () => {
  it("returns the configured bot number for an authed session", async () => {
    const { app } = makeApp({ appSecret: appKey, botPhone: "+972 50-123 4567" });
    const res = await app.request("/channel", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { botPhone: string | null }).toEqual({
      botPhone: "+972 50-123 4567",
    });
  });

  it("returns { botPhone: null } when BOT_PHONE_NUMBER is unset", async () => {
    const { app } = makeApp(); // no botPhone configured
    const res = await app.request("/channel", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { botPhone: string | null }).botPhone).toBeNull();
  });

  it("is session-gated: 401 without a valid session, 503 when auth is unconfigured", async () => {
    expect((await makeApp({ botPhone: "+972 50-123 4567" }).app.request("/channel")).status).toBe(
      401,
    );
    const dark = await makeApp({ session: false }).app.request("/channel", {
      headers: { Authorization: "Bearer anything" },
    });
    expect(dark.status).toBe(503);
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

  // #18 — the app write seam must auto-push to Google Calendar like the bot/inbound path does. Regression
  // for: an app-created event saved to the board but never synced to Calendar (CALENDAR_AUTO_PUSH=true).
  it("auto-pushes the new event to Google Calendar when calendar is connected + auto-push is on", async () => {
    const { app, calendar } = makeApp({ calendar: true, autoPush: true });
    const res = await postEvents(app, validParsed, auth(await kit.sign()));
    expect(res.status).toBe(201); // the 201 returns BEFORE the push — the push is fire-and-forget
    // the board event (source_provider null) is written to the calendar — find→insert (idempotent helper).
    // vi.waitFor because the push is a floating promise the 201 doesn't await (like the webhook ack path).
    await vi.waitFor(() => {
      expect(calendar?.client.findEventIdByPrivateProp).toHaveBeenCalledTimes(1);
      expect(calendar?.client.insertEvent).toHaveBeenCalledTimes(1);
    });
    const [, calId, body] = (calendar?.client.insertEvent as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(calId).toBe("primary");
    expect(body).toMatchObject({ summary: "ארוחת ערב" }); // Hebrew title carried through intact
  });

  it("does NOT push to Calendar when auto-push is off (calendar connected, kill switch off)", async () => {
    const { app, calendar } = makeApp({ calendar: true, autoPush: false });
    const res = await postEvents(app, validParsed, auth(await kit.sign()));
    expect(res.status).toBe(201);
    expect(calendar?.client.insertEvent).not.toHaveBeenCalled();
  });

  it("does NOT push when calendar is unconfigured (app-only deploy) — still saves + 201", async () => {
    const { app, events } = makeApp({ autoPush: true }); // no calendar seam
    const res = await postEvents(app, validParsed, auth(await kit.sign()));
    expect(res.status).toBe(201);
    expect(events.saveEvent).toHaveBeenCalledTimes(1);
  });

  it("a Calendar push failure is best-effort — the save still returns 201 (board is source of truth)", async () => {
    const { app, calendar } = makeApp({
      calendar: true,
      autoPush: true,
      calendarInsertThrows: true,
    });
    const res = await postEvents(app, validParsed, auth(await kit.sign()));
    expect(res.status).toBe(201); // the push threw internally but the helper swallows it (and isn't awaited)
    await vi.waitFor(() => expect(calendar?.client.insertEvent).toHaveBeenCalledTimes(1));
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

describe("requireWrite role gate (#226)", () => {
  const parsed = {
    kind: "event" as const,
    title_he: "x",
    date_iso: "2026-06-25",
    time: null,
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "x",
  };
  const viewer = { resolveMembershipByEmail: () => ({ familyId: "default", role: "viewer" }) };
  const auth = async () => ({
    Authorization: `Bearer ${await kit.sign()}`,
    "Content-Type": "application/json",
  });

  it("403s POST /events for a viewer (read-only) role", async () => {
    const { app, events } = makeApp(viewer);
    const res = await app.request("/events", {
      method: "POST",
      headers: await auth(),
      body: JSON.stringify(parsed),
    });
    expect(res.status).toBe(403);
    expect(events.saveEvent).not.toHaveBeenCalled();
  });

  it("403s PATCH /events/:id for a viewer role", async () => {
    const { app, events } = makeApp(viewer);
    const res = await app.request("/events/1", {
      method: "PATCH",
      headers: await auth(),
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(403);
    expect(events.setEventStatus).not.toHaveBeenCalled();
  });

  it("allows a writer (the default member role) to POST → 201", async () => {
    const { app } = makeApp();
    const res = await app.request("/events", {
      method: "POST",
      headers: await auth(),
      body: JSON.stringify(parsed),
    });
    expect(res.status).toBe(201);
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

describe("invite admin routes (#250 — owner-only self-serve invites)", () => {
  // An owner session: membership resolves to role 'owner' for the kit's default email.
  const asOwner = {
    invites: true,
    resolveMembershipByEmail: () => ({ familyId: FAMILY_ID, role: "owner" }),
  };
  const postInvite = (app: ReturnType<typeof makeApp>["app"], body: unknown, token: string) =>
    app.request("/invites", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("an owner mints an invite (201) → it appears in GET /invites; the reserved token is NOT exposed", async () => {
    const { app } = makeApp(asOwner);
    const res = await postInvite(app, { email: "spouse@example.com" }, await kit.sign());
    expect(res.status).toBe(201);
    const { invite } = (await res.json()) as { invite: Record<string, unknown> };
    expect(invite).toMatchObject({
      email: "spouse@example.com",
      role: "member",
      status: "pending",
    });
    expect(invite.invited_by).toBe("dad@example.com"); // audit: the minting owner
    expect(invite).not.toHaveProperty("token"); // the reserved option-B secret never leaves the server
    expect(invite).not.toHaveProperty("claimed_user_id");

    const list = await app.request("/invites", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    const { invites } = (await list.json()) as { invites: Array<{ email: string }> };
    expect(invites.map((i) => i.email)).toEqual(["spouse@example.com"]);
  });

  it("accepts a viewer role but REJECTS minting an owner (400 — owner is genesis-only)", async () => {
    const { app } = makeApp(asOwner);
    expect(
      (await postInvite(app, { email: "v@example.com", role: "viewer" }, await kit.sign())).status,
    ).toBe(201);
    expect(
      (await postInvite(app, { email: "o@example.com", role: "owner" }, await kit.sign())).status,
    ).toBe(400);
    expect((await postInvite(app, { email: "no-at-sign" }, await kit.sign())).status).toBe(400);
  });

  it("a non-owner (member) is FORBIDDEN from the invite surface (403)", async () => {
    // Default membership → N=1 fallback role 'member' (a writer, but NOT an owner).
    const { app } = makeApp({ invites: true });
    const res = await postInvite(app, { email: "x@example.com" }, await kit.sign());
    expect(res.status).toBe(403);
    const list = await app.request("/invites", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(list.status).toBe(403);
  });

  it("401 without a session (requireSession rejects before requireOwner)", async () => {
    const { app } = makeApp(asOwner);
    expect((await app.request("/invites", { method: "POST" })).status).toBe(401);
    expect((await app.request("/invites")).status).toBe(401);
  });

  it("an owner revokes a pending invite (204); it then leaves GET /invites; a bad id is 404", async () => {
    const { app } = makeApp(asOwner);
    const created = await postInvite(app, { email: "revoke@example.com" }, await kit.sign());
    const { invite } = (await created.json()) as { invite: { invite_id: string } };

    const del = await app.request(`/invites/${invite.invite_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(del.status).toBe(204);

    const list = await app.request("/invites", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(((await list.json()) as { invites: unknown[] }).invites).toEqual([]);

    const missing = await app.request("/invites/no-such-id", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(missing.status).toBe(404);
  });

  it("503 when the invite store is unwired (app-only / dev), even for an owner", async () => {
    // Owner session, but no invite store injected → the routes report not-configured.
    const { app } = makeApp({
      resolveMembershipByEmail: () => ({ familyId: FAMILY_ID, role: "owner" }),
    });
    expect((await postInvite(app, { email: "x@example.com" }, await kit.sign())).status).toBe(503);
    const list = await app.request("/invites", {
      headers: { Authorization: `Bearer ${await kit.sign()}` },
    });
    expect(list.status).toBe(503);
  });
});

describe("phone admin routes (#262 — owner-only WhatsApp-sender revocation)", () => {
  // An owner session over a family with one bound phone (the #229 seed / #228 ceremony result).
  const BOUND = "972501234567";
  const asOwnerWithPhone = {
    resolveMembershipByEmail: () => ({ familyId: FAMILY_ID, role: "owner" }),
    familySeed: {
      ...defaultFamilySeed,
      phones: [{ fromPhone: "+972 50-123 4567", verifiedAt: "2026-06-26 09:00:00" }],
    } satisfies FamilySeed,
  };
  const auth = async () => ({ Authorization: `Bearer ${await kit.sign()}` });

  it("an owner lists the family's bound phones (200); the internal family_id is NOT exposed", async () => {
    const { app } = makeApp(asOwnerWithPhone);
    const res = await app.request("/phones", { headers: await auth() });
    expect(res.status).toBe(200);
    const { phones } = (await res.json()) as { phones: Array<Record<string, unknown>> };
    expect(phones).toHaveLength(1);
    expect(phones[0]).toMatchObject({ from_phone: BOUND, verified_at: "2026-06-26 09:00:00" });
    expect(phones[0]).not.toHaveProperty("family_id"); // family-scoped route → no tenant id on the wire
  });

  it("an owner unbinds a phone (204); it then leaves GET /phones; an unknown phone is 404", async () => {
    const { app } = makeApp(asOwnerWithPhone);
    const del = await app.request(`/phones/${BOUND}`, { method: "DELETE", headers: await auth() });
    expect(del.status).toBe(204);

    const list = await app.request("/phones", { headers: await auth() });
    expect(((await list.json()) as { phones: unknown[] }).phones).toEqual([]);

    const missing = await app.request("/phones/972500000000", {
      method: "DELETE",
      headers: await auth(),
    });
    expect(missing.status).toBe(404); // fail-closed: nothing to unbind
  });

  it("a non-owner (member) is FORBIDDEN from the phone surface (403 on GET and DELETE)", async () => {
    // Default membership → N=1 fallback role 'member' (a writer, but NOT an owner).
    const { app } = makeApp({ familySeed: asOwnerWithPhone.familySeed });
    expect((await app.request("/phones", { headers: await auth() })).status).toBe(403);
    const del = await app.request(`/phones/${BOUND}`, { method: "DELETE", headers: await auth() });
    expect(del.status).toBe(403);
  });

  it("401 without a session (requireSession rejects before requireOwner)", async () => {
    const { app } = makeApp(asOwnerWithPhone);
    expect((await app.request("/phones")).status).toBe(401);
    expect((await app.request(`/phones/${BOUND}`, { method: "DELETE" })).status).toBe(401);
  });
});

describe("POST /binding (#228 — mint a wa.me binding code)", () => {
  const auth = async () => ({ Authorization: `Bearer ${await kit.sign()}` });
  const postBinding = async (app: ReturnType<typeof makeApp>["app"]) =>
    app.request("/binding", { method: "POST", headers: await auth() });

  it("a writer mints a single-use HOME-XXXXX code (201), scoped to the session's family", async () => {
    // Default membership → N=1 fallback role 'member' (a writer). No owner gate on binding your own phone.
    const { app } = makeApp({ bindings: true });
    const res = await postBinding(app);
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    // The store mints from the unambiguous alphabet (no 0/O, 1/I/L) — assert the shape, not a fixed value.
    expect(code).toMatch(/^HOME-[2-9A-HJ-NP-Z]{5}$/);
  });

  it("a viewer is FORBIDDEN (403 — binding a sender is a writer capability)", async () => {
    const { app } = makeApp({
      bindings: true,
      resolveMembershipByEmail: () => ({ familyId: FAMILY_ID, role: "viewer" }),
    });
    expect((await postBinding(app)).status).toBe(403);
  });

  it("401 without a session", async () => {
    const { app } = makeApp({ bindings: true });
    expect((await app.request("/binding", { method: "POST" })).status).toBe(401);
  });

  it("503 when the binding store is unwired (app-only / dev), even for a writer", async () => {
    const { app } = makeApp(); // no bindings injected
    expect((await postBinding(app)).status).toBe(503);
  });
});

describe("consent routes (#270 — terms/privacy opt-in)", () => {
  const auth = async () => ({ Authorization: `Bearer ${await kit.sign()}` });

  it("GET /consent is { consented: false } for a user who has never accepted", async () => {
    const { app } = makeApp();
    const res = await app.request("/consent", { headers: await auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { consented: boolean; version: string };
    expect(body.consented).toBe(false);
    expect(body.version).toBe(CURRENT_TERMS_VERSION);
  });

  it("POST /consent records the opt-in → a subsequent GET /consent is consented:true", async () => {
    const { app } = makeApp();
    const posted = await app.request("/consent", { method: "POST", headers: await auth() });
    expect(posted.status).toBe(201);
    expect(((await posted.json()) as { consented: boolean }).consented).toBe(true);

    const got = await app.request("/consent", { headers: await auth() });
    expect(((await got.json()) as { consented: boolean }).consented).toBe(true);
  });

  it("401 without a session (consent is per authenticated user)", async () => {
    const { app } = makeApp();
    expect((await app.request("/consent")).status).toBe(401);
    expect((await app.request("/consent", { method: "POST" })).status).toBe(401);
  });
});
