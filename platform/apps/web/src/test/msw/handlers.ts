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

export const handlers = [
  http.get("*/events", ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer")) {
      return new HttpResponse("Unauthorized", { status: 401 });
    }
    return HttpResponse.json({ events: sampleEvents });
  }),

  // #135 — Bearer-gated GET /messages, returning the wrapped { messages } feed.
  http.get("*/messages", ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer")) {
      return new HttpResponse("Unauthorized", { status: 401 });
    }
    return HttpResponse.json({ messages: sampleMessages });
  }),

  /**
   * Bearer-gated POST /events handler — echoes the parsed-event body back as a SavedEvent
   * (id: 999, source_provider: null). Mirrors what the real server will return once
   * POST /events is built (issue #96 client-seam only).
   */
  http.post("*/events", async ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer")) {
      return new HttpResponse("Unauthorized", { status: 401 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...body, id: 999, source_provider: null }, { status: 201 });
  }),
];
