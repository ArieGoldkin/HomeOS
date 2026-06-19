import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { fetchEvents } from "./events";

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
});
