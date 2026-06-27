import { HttpResponse, http } from "msw";

// A wrapped { events } payload mirroring rowToSaved: a forwarded row (source_provider null)
// and a google-derived row. The handler enforces the Bearer-gated contract.
export const sampleEvents = [
  {
    id: 1,
    kind: "event",
    title_he: "אסיפת הורים בגן",
    date_iso: "2026-06-21",
    time: "18:30",
    location: "גן רימון",
    assignee: null,
    recurrence: null,
    source_text: "תזכורת: אסיפת הורים",
    source_provider: null,
  },
  {
    id: 2,
    kind: "reminder",
    title_he: "תור לרופא",
    date_iso: "2026-06-22",
    time: null,
    location: null,
    assignee: "אמא",
    recurrence: null,
    source_text: "תור",
    source_provider: "google",
  },
];

// #135 — a wrapped { messages } payload mirroring rowToInboundDTO: a parsed forward + a non-text
// message that never became an event (null outcome). Both already allowlist-filtered by the server.
export const sampleMessages = [
  {
    wa_message_id: "wamid.1",
    from_phone: "972500000001",
    type: "text",
    text: "אסיפת הורים מחר ב-18:30",
    status: "done",
    outcome: "parsed",
    received_at: "2026-06-22T07:00:00Z",
    processed_at: "2026-06-22T07:00:01Z",
    family_id: "default",
  },
  {
    wa_message_id: "wamid.2",
    from_phone: "972500000001",
    type: "audio",
    text: null,
    status: "done",
    outcome: "text_only",
    received_at: "2026-06-22T08:00:00Z",
    processed_at: "2026-06-22T08:00:01Z",
    family_id: "default",
  },
];

/**
 * #111 — a CONNECTED `GET /oauth/google/status` payload (mirrors the shared `connectionStatusSchema`
 * connected member): the granted scopes + the access-token `expiresAt`. Use it with `server.use(...)` or
 * the {@link googleConnectedHandler} helper to flip a test from the default not-connected state.
 */
export const sampleGoogleStatusConnected = {
  connected: true as const,
  scopes: [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  expiresAt: "2026-06-25T18:30:00Z",
};

/** #111 — flip `GET /oauth/google/status` to the connected payload: `server.use(googleConnectedHandler())`. */
export const googleConnectedHandler = () =>
  http.get("*/oauth/google/status", () => HttpResponse.json(sampleGoogleStatusConnected));

/** #111 — flip `GET /oauth/google/status` to the configured-dark 503: `server.use(googleDarkHandler())`. */
export const googleDarkHandler = () =>
  http.get("*/oauth/google/status", () => new HttpResponse("Service Unavailable", { status: 503 }));

export const handlers = [
  /**
   * #111/#225 — session-gated `GET /oauth/google/status`. Defaults to the NOT-connected `{ connected: false }`;
   * per-test overrides (`googleConnectedHandler` / `googleDarkHandler` or an inline `server.use`) flip it to
   * connected or to the 503 dark state. The status read rides the Supabase session cookie, like /events.
   */
  http.get("*/oauth/google/status", () => {
    return HttpResponse.json({ connected: false });
  }),

  /**
   * #111 — Bearer-gated `GET /oauth/google/connect-url`. The Bearer here is the user-typed SETUP CODE
   * (a runtime arg, never bundled); the default echoes a consent URL on 200. Tests assert the distinct
   * error reasons (401/403/429/503) by overriding with `server.use(...)`.
   */
  http.get("*/oauth/google/connect-url", ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer")) {
      return new HttpResponse("Unauthorized", { status: 401 });
    }
    return HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?mock=1" });
  }),

  /**
   * #111 — Bearer-gated `POST /oauth/google/disconnect`. The Bearer is again the user-typed setup code.
   * Returns 204 on success; tests override to assert non-2xx handling.
   */
  http.post("*/oauth/google/disconnect", ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer")) {
      return new HttpResponse("Unauthorized", { status: 401 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // #225 — session-gated GET /events (the Supabase session cookie). Returns the wrapped { events }.
  http.get("*/events", () => {
    return HttpResponse.json({ events: sampleEvents });
  }),

  // #135/#225 — session-gated GET /messages, returning the wrapped { messages } feed.
  http.get("*/messages", () => {
    return HttpResponse.json({ messages: sampleMessages });
  }),

  /**
   * #225 — session-gated POST /events handler — echoes the parsed-event body back as a SavedEvent
   * (id: 999, source_provider: null). Mirrors what the real server returns; auth is the session cookie.
   */
  http.post("*/events", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...body, id: 999, source_provider: null }, { status: 201 });
  }),

  /**
   * #19/#225 — session-gated PATCH /events/:id status toggle. Returns sampleEvents[0] with the patched
   * status and the path id, mirroring the server's updated-SavedEvent response.
   */
  http.patch("*/events/:id", async ({ request, params }) => {
    const body = (await request.json()) as { status: string };
    return HttpResponse.json(
      { ...sampleEvents[0], id: Number(params.id), status: body.status },
      { status: 200 },
    );
  }),
];
