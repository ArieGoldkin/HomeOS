import { createHmac } from "node:crypto";
import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { type CallModel, createAgent } from "../../src/core/agent.ts";
import { processInbound } from "../../src/core/handler/index.ts";
import { CLARIFY_QUESTIONS, REPHRASE_HE } from "../../src/core/handler/shared/index.ts";
import {
  type ConversationStore,
  createConversationStore,
} from "../../src/db/conversation-store.ts";
import { createEventStore } from "../../src/db/event-store/index.ts";
import { createInboundStore } from "../../src/db/inbound-store.ts";
import type { CalendarClient } from "../../src/google/calendar.ts";
import type { GoogleOAuthClient } from "../../src/google/oauth.ts";
import { createServer } from "../../src/http/server.ts";
import type { InboundMessage } from "../../src/http/webhook.ts";
import type { ParseMessage } from "../../src/parsing/parser.ts";
import {
  type CalendarToolDeps,
  extractEventsTool,
  type GmailToolDeps,
  readGmailTool,
  searchEventsTool,
} from "../../src/tools/index.ts";

// Webhook HMAC is mandatory; integration posts are signed with this test key (named "key" to avoid
// the repo's secret scanner). The same key is wired into createServer below.
const appKey = "homeos-webhook-test-key";

/**
 * Integration harness: the REAL stores (in-memory SQLite), the REAL agent loop + processInbound +
 * handler, and the REAL Hono server, wired exactly like index.ts — only the two Claude surfaces are
 * stubbed (the agent's `callModel` loop AND the extractor's `parse`) and sendText is recorded, so
 * there's no live network. Exercises the Phase 3 + agent wiring the unit tests mock away:
 * persist-before-ack → queue → agent → multi-event save under seq → confirm → GET /events → ביטול
 * undo → dedup → boot-replay → seq-stability.
 */

const allowlist = ["972501234567"];

const evA: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: "אבא",
  recurrence: null,
  source_text: "single",
};
const evB: ParsedEvent = {
  ...evA,
  title_he: "טיול שנתי",
  date_iso: "2026-06-25",
  time: null,
  assignee: null,
};
const evC: ParsedEvent = {
  ...evA,
  title_he: "חוג כדורגל",
  date_iso: "2026-06-23",
  time: "16:30",
  recurrence: { freq: "weekly", weekday: 2 },
};

// Stub extractor: "multi" → two events, otherwise → one. Keyed on the message text.
const parse: ParseMessage = async (text: string) => {
  if (text.includes("multi")) return [evB, evC];
  if (text.includes("twin")) return [evA, { ...evA, title_he: "אותו זמן" }]; // two events at evA's slot
  return [evA];
};

/**
 * Stub the agent's model loop: turn 0 emits a tool_use for extract_events with the forwarded text;
 * once a tool_result comes back, end_turn. The extractor's own Claude call is stubbed by `parse`.
 */
const callModel: CallModel = async (req) => {
  const last = req.messages.at(-1);
  if (
    Array.isArray(last?.content) &&
    (last.content[0] as { type?: string })?.type === "tool_result"
  ) {
    return { stop_reason: "end_turn", content: [] };
  }
  // Honour turn-0 forced tool: the sync intent forces read_gmail.
  const forced = req.tool_choice.type === "tool" ? req.tool_choice.name : "extract_events";
  if (forced === "read_gmail") {
    return {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_gmail", name: "read_gmail", input: {} }],
    };
  }
  // #147 resolve path: the message is passed plainly (no <forwarded> wrap). The model emits the key
  // reference term — here a simple last-word heuristic stands in for the real extraction.
  if (forced === "search_events") {
    const t = typeof req.messages[0]?.content === "string" ? req.messages[0].content : "";
    const titleHint = t.trim().split(/\s+/).pop() ?? t;
    return {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu_se", name: "search_events", input: { titleHint } }],
    };
  }
  const wrapped = typeof req.messages[0]?.content === "string" ? req.messages[0].content : "";
  const text = wrapped
    .replace(/^Forwarded message to process:\n<forwarded-[0-9a-f]+>\n/, "")
    .replace(/\n<\/forwarded-[0-9a-f]+>$/, "");
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "tu_int", name: "extract_events", input: { text } }],
  };
};

/**
 * A recording Google Calendar fake (the #87 integration stubs ONLY callModel/parse + the calendar
 * client; the stores + handler are real). `existingGcalId` is what findEventIdByPrivateProp resolves to:
 * `null` ⇒ a brand-new mirror (auto-push INSERTs), a string ⇒ an existing mirror (edit PATCHes, cancel
 * DELETEs). Every write is recorded so a test can assert the best-effort mirror op (G25).
 */
function recordingCalendar(existingGcalId: string | null = null) {
  const calls = {
    insert: [] as unknown[],
    patch: [] as Array<{ id: string; body: unknown }>,
    delete: [] as string[],
  };
  // `satisfies CalendarClient` keeps the methods the handler reads (find/insert/patch/delete) honestly
  // type-checked — a signature drift in the real interface now fails this fake instead of passing silently.
  const client = {
    list: async () => [],
    findEventIdByPrivateProp: async () => existingGcalId,
    insertEvent: async (_t: string, _c: string, body: unknown) => {
      calls.insert.push(body);
      return { id: "gcal-new" };
    },
    patchEvent: async (_t: string, _c: string, id: string, body: unknown) => {
      calls.patch.push({ id, body });
      return { id };
    },
    deleteEvent: async (_t: string, _c: string, id: string) => {
      calls.delete.push(id);
    },
  } satisfies CalendarClient;
  const calendar: CalendarToolDeps = {
    client,
    // OAuth plumbing getValidAccessToken needs: only `credentials.get` is read here (the token is
    // non-expired so `oauthClient.refresh` is never called). The OAuth methods return rich GoogleTokens
    // we don't model, so this sub-object is the ONE place type-checking is relaxed (`as unknown as`) —
    // and ONLY on the dead-but-required OAuth plumbing, NOT the calendar/credential surface under test.
    oauthClient: {
      exchangeCode: async () => ({}),
      refresh: async () => ({}),
      revoke: async () => {},
    } as unknown as GoogleOAuthClient,
    credentials: {
      get: () => ({
        accessToken: "acc",
        refreshToken: "ref",
        expiry: "2099-01-01 00:00:00",
        scopes: [],
      }),
      updateTokens: () => {},
      delete: () => 0, // CredentialStore.delete returns the rows-removed count, not void
    },
    calendarId: "primary",
    windowDays: 30,
    maxEvents: 20,
  };
  return { calendar, calls };
}

function makeSystem(
  parseImpl: ParseMessage = parse,
  members: Record<string, string> = {},
  google?: GmailToolDeps,
  // #87: opt-in conversational lifecycle wiring (open-thread store, calendar mirror, TTL, auto-push).
  extra: {
    conversations?: ConversationStore;
    calendar?: CalendarToolDeps;
    conversationTtlMs?: number;
    autoPush?: boolean;
  } = {},
) {
  const events = createEventStore(":memory:");
  const inbound = createInboundStore(":memory:");
  const sent: Array<{ to: string; body: string }> = [];
  const sendText = async (to: string, body: string) => {
    sent.push({ to, body });
  };
  const agent = createAgent({
    callModel,
    tools: google
      ? [extractEventsTool(parseImpl), readGmailTool(parseImpl)]
      : [extractEventsTool(parseImpl)],
  });
  // #147 — the resolve agent (search_events only), wired exactly like index.ts.
  const resolveAgent = createAgent({ callModel, tools: [searchEventsTool()] });
  const runInbound = (msg: InboundMessage): Promise<void> =>
    processInbound(msg, {
      allowlist,
      agent,
      resolveAgent,
      events,
      sendText,
      inbound,
      members,
      google,
      parse: parseImpl, // #84: the non-persisting re-parse seam a clarify RESUME uses (harmless otherwise)
      ...(extra.conversations ? { conversations: extra.conversations } : {}),
      ...(extra.calendar ? { calendar: extra.calendar } : {}),
      ...(extra.conversationTtlMs !== undefined
        ? { conversationTtlMs: extra.conversationTtlMs }
        : {}),
      autoPushCalendar: extra.autoPush,
      now: () => new Date("2026-06-20T09:00:00Z"),
    });
  const app = createServer({
    verifyToken: "verify",
    inbound,
    process: runInbound,
    events,
    allowlist,
    readToken: "read-secret",
    appSecret: appKey,
  });
  return { app, events, inbound, sent, runInbound };
}

function webhook(id: string, text: string, from = "972501234567"): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {},
              messages: [{ from, id, timestamp: "1", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

function post(app: ReturnType<typeof makeSystem>["app"], body: string) {
  const signature = `sha256=${createHmac("sha256", appKey).update(body, "utf8").digest("hex")}`;
  return app.request("/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body,
  });
}

describe("integration: webhook → queue → store → confirm → read → undo", () => {
  it("runs the full Phase 3 flow against real stores", async () => {
    const sys = makeSystem();

    // 1) A single-event forward → one row, Hebrew confirm with the assignee.
    // #71: the tool persists DURING the agent loop (before the final model turn + confirm), so wait
    // on the confirm — the true LAST side-effect — not on the row, to avoid racing the send.
    expect((await post(sys.app, webhook("wamid.1", "single"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(1));
    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.sent.at(-1)?.body).toContain("אסיפת הורים");
    expect(sys.sent.at(-1)?.body).toContain("אבא"); // assignee surfaced

    // 2) A multi-event forward → two more rows under distinct seq, "2 פריטים" summary.
    expect((await post(sys.app, webhook("wamid.multi", "multi"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(2));
    expect(sys.events.listEvents()).toHaveLength(3);
    expect(sys.sent.at(-1)?.body).toContain("2");
    expect(sys.sent.at(-1)?.body).toContain("חוג כדורגל");

    // 3) GET /events returns the board, token-gated, date-ordered, full shape.
    const unauth = await sys.app.request("/events");
    expect(unauth.status).toBe(401);
    const res = await sys.app.request("/events", {
      headers: { Authorization: "Bearer read-secret" },
    });
    expect(res.status).toBe(200);
    const board = (await res.json()) as { events: ParsedEvent[] };
    expect(board.events).toHaveLength(3);
    expect(board.events.map((e) => e.date_iso)).toEqual(["2026-06-21", "2026-06-23", "2026-06-25"]);
    expect(board.events[1]?.recurrence).toEqual({ freq: "weekly", weekday: 2 });

    // 4) ביטול removes the LAST message's events (the multi-event pair) → back to one.
    expect((await post(sys.app, webhook("wamid.cancel", "ביטול"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(3));
    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.sent.at(-1)?.body).toMatch(/בוטל/);

    // 5) A duplicate delivery of wamid.1 is de-duped at the queue → no extra row.
    await post(sys.app, webhook("wamid.1", "single"));
    await new Promise((r) => setTimeout(r, 20));
    expect(sys.events.listEvents()).toHaveLength(1);
  });

  it("does not duplicate a meeting already on the same (date, time) slot — slot dedup", async () => {
    const sys = makeSystem();

    // First forward of a timed event (evA: 2026-06-21 18:30) → saved + confirmed.
    expect((await post(sys.app, webhook("wamid.dup1", "single"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(1));
    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.sent.at(-1)?.body).toContain("הוספתי");

    // A DIFFERENT message describing the SAME slot -> deduped: no second row, "already on the board".
    expect((await post(sys.app, webhook("wamid.dup2", "single"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(2));
    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.sent.at(-1)?.body).toContain("כבר ביומן");
  });

  it("collapses two events at the SAME slot within ONE forward to a single row (F1)", async () => {
    const sys = makeSystem();
    // one message parsing to two events at evA's slot (2026-06-21 18:30) -> only one row saved.
    expect((await post(sys.app, webhook("wamid.twin", "twin"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(1));
    expect(sys.events.listEvents()).toHaveLength(1); // intra-message slot collision collapsed
    expect(sys.sent.at(-1)?.body).toContain("הוספתי"); // confirms the saved one (silent collapse)
  });

  it("boot-replays a pending inbound (crash-window recovery)", async () => {
    const sys = makeSystem();
    // Persist an inbound but never process it — the ack-then-crash window.
    sys.inbound.enqueue({ id: "wamid.replay", from: "972501234567", type: "text", text: "replay" });
    expect(sys.inbound.pending()).toHaveLength(1);

    // Boot-replay (what index.ts does on startup).
    for (const msg of sys.inbound.pending()) await sys.runInbound(msg);

    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.inbound.pending()).toHaveLength(0); // settled
  });

  it("re-running the same wa_message_id with a reordered extraction adds NO duplicate rows (G-seq)", async () => {
    // A boot-replay (or Meta retry) re-extracts; a non-deterministic model could return the same
    // events in a DIFFERENT order. saveEvent dedups on (wa_message_id, seq), so the row count must
    // stay stable — the single-extraction invariant + composite key guard against duplicates.
    let call = 0;
    const flip: ParseMessage = async () => (call++ === 0 ? [evB, evC] : [evC, evB]);
    const sys = makeSystem(flip);
    const msg: InboundMessage = {
      id: "wamid.seq",
      from: "972501234567",
      type: "text",
      text: "two",
    };

    await sys.runInbound(msg);
    expect(sys.events.listEvents()).toHaveLength(2);

    await sys.runInbound(msg); // replay — extraction returns the reversed order this time
    expect(sys.events.listEvents()).toHaveLength(2); // no duplicate rows
  });

  it("a direct first-person command resolves the assignee to the sender (#14)", async () => {
    // Extractor stub that mirrors the prompt nuance: first-person → assignee = the server-supplied
    // sender name (which threads handler → agent → extract_events → parse via ToolContext).
    const directParse: ParseMessage = async (_text, _today, senderName) => [
      { ...evA, title_he: "פיזיותרפיה", assignee: senderName ?? null },
    ];
    const sys = makeSystem(directParse, { "972501234567": "אבא" });

    await sys.runInbound({
      id: "wamid.cmd",
      from: "972501234567",
      type: "text",
      text: "יש לי פיזיותרפיה מחר, תכניס ליומן",
    });

    expect(sys.events.listEvents()[0]?.assignee).toBe("אבא");
  });

  it("syncs Gmail on 'סנכרן מייל' → board rows tagged google, idempotent on re-run, purgeable (#72)", async () => {
    const emails = [
      { id: "g1", subject: "אסיפת הורים", bodyText: "מחר ב-18:30" },
      { id: "g2", subject: "חוג כדורגל", bodyText: "ביום שלישי" },
    ];
    const gmail = {
      client: {
        list: async () => emails.map((m) => ({ id: m.id, threadId: "t" })),
        get: async (_t: string, id: string) => emails.find((m) => m.id === id),
      },
      oauthClient: {
        exchangeCode: async () => ({}),
        refresh: async () => ({}),
        revoke: async () => {},
      },
      credentials: {
        get: () => ({
          accessToken: "acc",
          refreshToken: "ref",
          expiry: "2099-01-01 00:00:00",
          scopes: [],
        }),
        updateTokens: () => {},
        delete: () => {},
      },
      maxMessages: 10,
      queryWindow: "newer_than:7d",
      allowedLabels: [],
    } as unknown as GmailToolDeps;
    const sys = makeSystem(parse, {}, gmail);

    // First sync → two rows (one per email), both tagged source_provider="google".
    expect((await post(sys.app, webhook("wamid.s1", "סנכרן מייל"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(1));
    const rows = sys.events.listEvents();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source_provider === "google")).toBe(true);
    expect(sys.sent.at(-1)?.body).toContain("הוספתי");

    // Re-sync (same gmail ids) → idempotent on gmail:<id>: still two rows (AC4).
    expect((await post(sys.app, webhook("wamid.s2", "סנכרן מייל"))).status).toBe(200);
    await vi.waitFor(() => expect(sys.sent).toHaveLength(2));
    expect(sys.events.listEvents()).toHaveLength(2);

    // Disconnect purge — the #61 seam, now activated by the google tag.
    expect(sys.events.deleteByProvider("google")).toBe(2);
    expect(sys.events.listEvents()).toHaveLength(0);
  });
});

// #87 — the conversational lifecycle end-to-end, against REAL stores + handler + agent (only callModel,
// parse, and the calendar client are stubbed). Locks the clarify/cancel/edit chains incl. the Google
// mirror, the boot sweep-before-replay ordering (G24), and the single-purpose guardrails.
describe("integration: conversational lifecycle (#87)", () => {
  const sender = "972501234567";
  const NOW_SQLITE = "2026-06-20 09:00:00";

  it("clarify → resume → save + Calendar auto-push (#84/#87)", async () => {
    const conversations = createConversationStore(":memory:");
    const { calendar, calls } = recordingCalendar(null); // new event → the mirror is INSERTed
    // The forward lacks a date (opens a templated thread); the answer re-parses to a dated event.
    const clarifyParse: ParseMessage = async (text) =>
      text.includes("בלי תאריך")
        ? [{ ...evA, needs_clarification: { reason: "missing_date" } }]
        : [{ ...evA, date_iso: "2026-06-25", time: "17:00" }];
    const sys = makeSystem(clarifyParse, {}, undefined, {
      conversations,
      calendar,
      autoPush: true,
    });

    // 1) Date-less forward → ONE server template, nothing saved, a clarify thread now holds the draft.
    await sys.runInbound({
      id: "wamid.cl1",
      from: sender,
      type: "text",
      text: "אסיפת הורים בלי תאריך",
    });
    expect(sys.events.listEvents()).toHaveLength(0);
    expect(sys.sent.at(-1)?.body).toBe(CLARIFY_QUESTIONS.missing_date);
    expect(conversations.getPending(sender, NOW_SQLITE)?.kind).toBe("clarify");

    // 2) The answer resumes (no fresh agent loop) → saves, confirms, and best-effort pushes the mirror.
    await sys.runInbound({ id: "wamid.cl2", from: sender, type: "text", text: "ביום חמישי בחמש" });
    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.sent.at(-1)?.body).toContain("הוספתי");
    expect(calls.insert).toHaveLength(1); // Google mirror created
    expect(conversations.getPending(sender, NOW_SQLITE)).toBeNull(); // single-use, thread closed
  });

  it("cancel-by-ref → board delete + Google delete, idempotent on re-cancel (#85/#87/G25)", async () => {
    const { calendar, calls } = recordingCalendar("gcal-1"); // an existing mirror → it gets DELETEd
    const sys = makeSystem(parse, {}, undefined, { calendar });

    // Seed a board row (evA "אסיפת הורים") via a normal forward.
    await sys.runInbound({ id: "wamid.seed", from: sender, type: "text", text: "single" });
    expect(sys.events.listEvents()).toHaveLength(1);

    // Cancel by reference → the board row + its Google mirror are removed.
    await sys.runInbound({ id: "wamid.can1", from: sender, type: "text", text: "בטל אסיפת הורים" });
    expect(sys.events.listEvents()).toHaveLength(0);
    expect(calls.delete).toEqual(["gcal-1"]);
    expect(sys.sent.at(-1)?.body).toMatch(/בוטל/);

    // Re-cancel the same reference → idempotent: not-found, and NO second mirror delete.
    await sys.runInbound({ id: "wamid.can2", from: sender, type: "text", text: "בטל אסיפת הורים" });
    expect(sys.sent.at(-1)?.body).toContain("לא מצאתי");
    expect(calls.delete).toHaveLength(1);
  });

  it("edit-by-ref → board update + Google patch (#86/#87/G25)", async () => {
    const { calendar, calls } = recordingCalendar("gcal-1"); // an existing mirror → it gets PATCHed
    const sys = makeSystem(parse, {}, undefined, { calendar });

    await sys.runInbound({ id: "wamid.seed", from: sender, type: "text", text: "single" });
    expect(sys.events.listEvents()[0]?.time).toBe("18:30");

    // Edit the time by reference → the board row is patched in place and the mirror follows.
    await sys.runInbound({
      id: "wamid.ed1",
      from: sender,
      type: "text",
      text: "שנה אסיפת הורים לשעה 19:45",
    });
    expect(sys.events.listEvents()[0]?.time).toBe("19:45");
    expect(calls.patch).toHaveLength(1);
    expect(calls.patch[0]?.id).toBe("gcal-1");
  });

  it("boot sweep runs BEFORE replay — a LIVE open thread is not re-asked (G24)", async () => {
    const conversations = createConversationStore(":memory:");
    const sys = makeSystem(parse, {}, undefined, { conversations });

    // Crash-after-question-before-markDone: an open clarify thread + a still-pending inbound.
    conversations.create({
      fromPhone: sender,
      payload: { kind: "clarify", reason: "ambiguous_title", draft: evA },
      expiresAt: "2026-06-20 12:00:00", // live at NOW
    });
    sys.inbound.enqueue({ id: "wamid.boot", from: sender, type: "text", text: "אירוע כלשהו" });

    // Exactly index.ts's boot order: sweep stale threads FIRST, then replay pending inbound.
    conversations.expireStale(NOW_SQLITE); // the live thread survives the sweep
    for (const msg of sys.inbound.pending()) await sys.runInbound(msg);

    // The replayed forward hit the OPEN thread → resumed; the question is NEVER re-sent.
    expect(sys.sent.some((s) => s.body === CLARIFY_QUESTIONS.ambiguous_title)).toBe(false);
    expect(conversations.getPending(sender, NOW_SQLITE)).toBeNull(); // resolved single-use
    expect(sys.inbound.pending()).toHaveLength(0); // settled
  });

  it("boot sweep removes an EXPIRED thread before replay — message is re-asked freshly (ordering)", async () => {
    const conversations = createConversationStore(":memory:");
    // The replayed forward parses as needing a date → a FRESH clarify opens after the stale one is swept.
    const clarifyParse: ParseMessage = async () => [
      { ...evA, needs_clarification: { reason: "missing_date" } },
    ];
    const sys = makeSystem(clarifyParse, {}, undefined, { conversations });

    conversations.create({
      fromPhone: sender,
      payload: { kind: "clarify", reason: "ambiguous_title", draft: evA },
      expiresAt: "2026-06-20 08:00:00", // EXPIRED at NOW
    });
    sys.inbound.enqueue({ id: "wamid.boot2", from: sender, type: "text", text: "אסיפה בלי תאריך" });

    conversations.expireStale(NOW_SQLITE); // sweeps the expired thread FIRST
    for (const msg of sys.inbound.pending()) await sys.runInbound(msg);

    // Swept → the replay did NOT resume into the stale thread; it parsed fresh and asked the question.
    expect(sys.sent.at(-1)?.body).toBe(CLARIFY_QUESTIONS.missing_date);
    expect(sys.events.listEvents()).toHaveLength(0);
  });

  it("agentic cancel: resolves by ASSIGNEE (deterministic miss) → confirm → כן → board+Google delete (#147)", async () => {
    const { calendar, calls } = recordingCalendar("gcal-1"); // an existing mirror → DELETEd on confirm
    const conversations = createConversationStore(":memory:");
    const sys = makeSystem(parse, {}, undefined, { calendar, conversations });

    // Seed evA (title "אסיפת הורים", assignee "אבא") via a normal forward.
    await sys.runInbound({ id: "wamid.seed", from: sender, type: "text", text: "single" });
    expect(sys.events.listEvents()).toHaveLength(1);

    // Cancel by ASSIGNEE: title-only findEventsByRef misses "אבא" → the resolve agent kicks in.
    await sys.runInbound({
      id: "wamid.c1",
      from: sender,
      type: "text",
      text: "בטל את הפגישה של אבא",
    });
    // Confirm-before-destroy: a thread is open, NOTHING deleted yet, no junk event created (AC#3).
    expect(sys.events.listEvents()).toHaveLength(1);
    expect(sys.sent.at(-1)?.body).toContain("לבטל");
    expect(conversations.getPending(sender, NOW_SQLITE)?.kind).toBe("cancel");
    expect(calls.delete).toHaveLength(0);

    // Confirm with כן → board delete + best-effort Google mirror delete.
    await sys.runInbound({ id: "wamid.c2", from: sender, type: "text", text: "כן" });
    expect(sys.events.listEvents()).toHaveLength(0);
    expect(calls.delete).toEqual(["gcal-1"]);
    expect(sys.sent.at(-1)?.body).toMatch(/בוטל/);
  });

  it("agentic cancel: לא at the confirm leaves the board untouched (fail-closed, #147)", async () => {
    const { calendar, calls } = recordingCalendar("gcal-1");
    const conversations = createConversationStore(":memory:");
    const sys = makeSystem(parse, {}, undefined, { calendar, conversations });

    await sys.runInbound({ id: "wamid.seed", from: sender, type: "text", text: "single" });
    await sys.runInbound({
      id: "wamid.c1",
      from: sender,
      type: "text",
      text: "בטל את הפגישה של אבא",
    });
    await sys.runInbound({ id: "wamid.c2", from: sender, type: "text", text: "לא" });

    expect(sys.events.listEvents()).toHaveLength(1); // nothing deleted
    expect(calls.delete).toHaveLength(0); // no Google delete
    expect(conversations.getPending(sender, NOW_SQLITE)).toBeNull(); // consumed
  });

  it("a forwarded message CONTAINING 'בטל' (not a leading command) still extracts, never deletes (AC#4)", async () => {
    const sys = makeSystem();
    // Seed two events at distinct slots ("multi" → evB 06-25 + evC 06-23).
    await sys.runInbound({ id: "wamid.seed", from: sender, type: "text", text: "multi" });
    expect(sys.events.listEvents()).toHaveLength(2);

    // "תזכורת…: בטל…" does not START with a cancel verb → not a command → extracted as a forward (evA, a
    // different slot), and the two seeded events are untouched.
    await sys.runInbound({
      id: "wamid.fwd",
      from: sender,
      type: "text",
      text: "תזכורת חשובה: בטל את המנוי עד מחר",
    });
    expect(sys.events.listEvents()).toHaveLength(3); // extracted, nothing deleted
    expect(sys.sent.at(-1)?.body).toContain("הוספתי");
  });

  it("guardrails unchanged: replies are SERVER-owned templates, never model prose (single-purpose, G1–G16)", async () => {
    const conversations = createConversationStore(":memory:");
    // null → unparseable (no chat answer); a date-less forward → the server clarify template.
    const guardParse: ParseMessage = async (text) =>
      text.includes("בלי תאריך")
        ? [{ ...evA, needs_clarification: { reason: "missing_date" } }]
        : null;
    const sys = makeSystem(guardParse, {}, undefined, { conversations });

    // An open-domain message gets the REPHRASE template — the bot never free-form chats (#30/G3/G5).
    await sys.runInbound({ id: "wamid.g1", from: sender, type: "text", text: "מה שלומך היום?" });
    expect(sys.sent.at(-1)?.body).toBe(REPHRASE_HE);

    // A clarify question is the EXACT server template for the reason — the model only emits the enum.
    await sys.runInbound({
      id: "wamid.g2",
      from: sender,
      type: "text",
      text: "אסיפת הורים בלי תאריך",
    });
    expect(sys.sent.at(-1)?.body).toBe(CLARIFY_QUESTIONS.missing_date);
  });
});
