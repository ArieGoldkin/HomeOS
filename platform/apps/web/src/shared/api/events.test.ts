import type { ParsedEvent } from "@homeos/shared";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { sampleEvents } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { createEvent, fetchEvents, setEventStatus } from "./events";

/** A valid ParsedEvent fixture — source_text is required by parsedEventSchema. */
const parsedFixture: ParsedEvent = {
  kind: "event",
  title_he: "בדיקה",
  date_iso: "2026-06-21",
  time: "10:00",
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "נוסף ידנית",
};

describe("fetchEvents", () => {
  it("reads .events from the wrapped payload and validates the rows", async () => {
    const events = await fetchEvents();
    expect(events).toHaveLength(2);
    // a real forwarded row parses with source_provider null
    expect(events[0]?.source_provider).toBeNull();
    expect(events[1]?.source_provider).toBe("google");
  });

  it("throws on a 401 (bad/missing token)", async () => {
    server.use(http.get("*/events", () => new HttpResponse("Unauthorized", { status: 401 })));
    await expect(fetchEvents()).rejects.toThrow(/401/);
  });

  it("rejects a bare array (payload must be wrapped)", async () => {
    server.use(http.get("*/events", () => HttpResponse.json([])));
    await expect(fetchEvents()).rejects.toThrow();
  });

  it("sends the session cookie (credentials: include) and no Authorization header (#225)", async () => {
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.get("*/events", ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ events: sampleEvents });
      }),
    );
    await fetchEvents();
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });
});

describe("createEvent", () => {
  it("POSTs and returns a parsed SavedEvent (id 999)", async () => {
    const saved = await createEvent(parsedFixture);
    expect(saved.id).toBe(999);
    expect(saved.source_provider).toBeNull();
    expect(saved.title_he).toBe("בדיקה");
    expect(saved.source_text).toBe("נוסף ידנית");
  });

  it("sends the full ParsedEvent body with the session cookie (credentials: include)", async () => {
    let captured: unknown;
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.post("*/events", async ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        captured = await request.json();
        return HttpResponse.json(
          { ...(captured as Record<string, unknown>), id: 999, source_provider: null },
          { status: 201 },
        );
      }),
    );
    await createEvent(parsedFixture);
    expect(captured).toMatchObject({
      kind: "event",
      title_he: "בדיקה",
      date_iso: "2026-06-21",
      time: "10:00",
      source_text: "נוסף ידנית",
    });
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });

  it("throws on a 401 (no valid session)", async () => {
    server.use(http.post("*/events", () => new HttpResponse("Unauthorized", { status: 401 })));
    await expect(createEvent(parsedFixture)).rejects.toThrow(/POST \/events failed \(401\)/);
  });

  it("rejects a malformed server response (missing id)", async () => {
    server.use(
      http.post("*/events", () => HttpResponse.json({ title_he: "broken" }, { status: 201 })),
    );
    await expect(createEvent(parsedFixture)).rejects.toThrow();
  });
});

describe("setEventStatus (#19)", () => {
  it("PATCHes the status and returns the parsed SavedEvent", async () => {
    const saved = await setEventStatus(1, "done");
    expect(saved.id).toBe(1);
    expect(saved.status).toBe("done");
  });

  it("sends the status in the request body with the session cookie (credentials: include)", async () => {
    let captured: unknown;
    let credentials: RequestCredentials | undefined;
    server.use(
      http.patch("*/events/:id", async ({ request, params }) => {
        credentials = request.credentials;
        captured = await request.json();
        return HttpResponse.json(
          { ...sampleEvents[0], id: Number(params.id), status: "done" },
          { status: 200 },
        );
      }),
    );
    await setEventStatus(1, "done");
    expect(captured).toEqual({ status: "done" });
    expect(credentials).toBe("include");
  });

  it("throws on a 404 (row isn't a board row)", async () => {
    server.use(http.patch("*/events/:id", () => new HttpResponse("Not found", { status: 404 })));
    await expect(setEventStatus(999, "done")).rejects.toThrow(/PATCH \/events\/999 failed \(404\)/);
  });
});
