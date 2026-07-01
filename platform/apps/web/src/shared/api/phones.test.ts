import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { samplePhones } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { fetchPhones, unbindPhone } from "./phones";

describe("fetchPhones", () => {
  it("reads { phones } from the wrapped payload and validates it", async () => {
    const phones = await fetchPhones();
    expect(phones).toHaveLength(1);
    expect(phones[0]).toMatchObject({
      from_phone: "972501234567",
      verified_at: "2026-06-26T09:00:00Z",
    });
  });

  it("throws on a 403 (the owner gate — a non-owner can't list bound phones)", async () => {
    server.use(http.get("*/phones", () => new HttpResponse("Forbidden", { status: 403 })));
    await expect(fetchPhones()).rejects.toThrow(/403/);
  });

  it("rejects a malformed payload (a missing { phones } envelope)", async () => {
    server.use(http.get("*/phones", () => HttpResponse.json({ wrong: [] })));
    await expect(fetchPhones()).rejects.toThrow();
  });

  it("sends the session cookie (credentials: include) and no Authorization header", async () => {
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.get("*/phones", ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ phones: samplePhones });
      }),
    );
    await fetchPhones();
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });
});

describe("unbindPhone", () => {
  it("resolves on a 204", async () => {
    await expect(unbindPhone("972501234567")).resolves.toBeUndefined();
  });

  it("throws on a 404 (unknown / cross-family / already-unbound phone)", async () => {
    server.use(
      http.delete("*/phones/:phone", () => new HttpResponse("Not found", { status: 404 })),
    );
    await expect(unbindPhone("972500000000")).rejects.toThrow(/404/);
  });
});
