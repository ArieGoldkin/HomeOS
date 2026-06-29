import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { sampleFamily } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { fetchFamily } from "./family";

describe("fetchFamily", () => {
  it("reads { family, members } from the wrapped payload and validates it", async () => {
    const roster = await fetchFamily();
    expect(roster.family.display_name).toBe("משפחת הבית");
    expect(roster.members).toHaveLength(4);
    expect(roster.members[0]).toEqual({ name: "אבא", role: "owner" });
  });

  it("throws on a 401 (bad/missing session)", async () => {
    server.use(http.get("*/family", () => new HttpResponse("Unauthorized", { status: 401 })));
    await expect(fetchFamily()).rejects.toThrow(/401/);
  });

  it("throws on a 404 (no family seeded)", async () => {
    server.use(http.get("*/family", () => new HttpResponse("Not found", { status: 404 })));
    await expect(fetchFamily()).rejects.toThrow(/404/);
  });

  it("rejects a malformed payload (missing family.display_name)", async () => {
    server.use(http.get("*/family", () => HttpResponse.json({ members: [] })));
    await expect(fetchFamily()).rejects.toThrow();
  });

  it("sends the session cookie (credentials: include) and no Authorization header (#225)", async () => {
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.get("*/family", ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        return HttpResponse.json(sampleFamily);
      }),
    );
    await fetchFamily();
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });
});
