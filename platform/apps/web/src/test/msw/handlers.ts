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

export const handlers = [
  http.get("*/events", ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer")) {
      return new HttpResponse("Unauthorized", { status: 401 });
    }
    return HttpResponse.json({ events: sampleEvents });
  }),
];
