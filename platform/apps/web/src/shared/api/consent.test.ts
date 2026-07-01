import { CURRENT_TERMS_VERSION } from "@homeos/shared";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { acceptConsent, fetchConsent } from "./consent";

describe("fetchConsent", () => {
  it("reads the { consented, version } status", async () => {
    server.use(
      http.get("*/consent", () => HttpResponse.json({ consented: false, version: "2026-07-01" })),
    );
    await expect(fetchConsent()).resolves.toEqual({ consented: false, version: "2026-07-01" });
  });

  it("rejects a malformed payload (missing fields)", async () => {
    server.use(http.get("*/consent", () => HttpResponse.json({ consented: true })));
    await expect(fetchConsent()).rejects.toThrow();
  });

  it("throws on a non-2xx so the gate can fail open", async () => {
    server.use(http.get("*/consent", () => new HttpResponse("Server Error", { status: 500 })));
    await expect(fetchConsent()).rejects.toThrow(/500/);
  });
});

describe("acceptConsent", () => {
  it("posts and returns the now-consented status", async () => {
    await expect(acceptConsent()).resolves.toEqual({
      consented: true,
      version: CURRENT_TERMS_VERSION,
    });
  });

  it("throws on a non-2xx", async () => {
    server.use(http.post("*/consent", () => new HttpResponse("nope", { status: 401 })));
    await expect(acceptConsent()).rejects.toThrow(/401/);
  });

  it("sends the session cookie and no Authorization header", async () => {
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.post("*/consent", ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        return HttpResponse.json(
          { consented: true, version: CURRENT_TERMS_VERSION },
          { status: 201 },
        );
      }),
    );
    await acceptConsent();
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });
});
