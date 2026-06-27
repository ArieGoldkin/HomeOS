import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { googleConnectedHandler, googleDarkHandler } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import {
  disconnectGoogle,
  fetchConnectionStatus,
  GoogleConnectError,
  GoogleNotConfiguredError,
  startGoogleConnect,
} from "./google";

describe("fetchConnectionStatus (#111)", () => {
  it("defaults to the not-connected status, parsed by the shared schema", async () => {
    const status = await fetchConnectionStatus();
    expect(status.connected).toBe(false);
  });

  it("returns the connected payload with scopes + expiresAt when overridden", async () => {
    server.use(googleConnectedHandler());
    const status = await fetchConnectionStatus();
    expect(status.connected).toBe(true);
    if (status.connected) {
      expect(status.scopes.length).toBeGreaterThan(0);
      expect(status.expiresAt).toBe("2026-06-25T18:30:00Z");
    }
  });

  it("throws GoogleNotConfiguredError (the dark state) on a 503", async () => {
    server.use(googleDarkHandler());
    await expect(fetchConnectionStatus()).rejects.toBeInstanceOf(GoogleNotConfiguredError);
  });

  it("throws loudly when the body has the wrong shape (bad schema)", async () => {
    server.use(http.get("*/oauth/google/status", () => HttpResponse.json({ connected: "yes" })));
    await expect(fetchConnectionStatus()).rejects.toThrow();
  });

  it("rejects a connected payload carrying a leaked token (strictObject)", async () => {
    server.use(
      http.get("*/oauth/google/status", () =>
        HttpResponse.json({
          connected: true,
          scopes: ["calendar"],
          expiresAt: "2026-06-25T18:30:00Z",
          refresh_token: "leaked-secret",
        }),
      ),
    );
    await expect(fetchConnectionStatus()).rejects.toThrow();
  });

  it("throws a generic error on a non-503 failure (e.g. 401)", async () => {
    server.use(
      http.get("*/oauth/google/status", () => new HttpResponse("Unauthorized", { status: 401 })),
    );
    await expect(fetchConnectionStatus()).rejects.toThrow(/401/);
    await expect(fetchConnectionStatus()).rejects.not.toBeInstanceOf(GoogleNotConfiguredError);
  });

  it("rides the session cookie (credentials: include), not a bearer token (#225)", async () => {
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.get("*/oauth/google/status", ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ connected: false });
      }),
    );
    await fetchConnectionStatus();
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });
});

describe("startGoogleConnect (#111)", () => {
  it("returns { url } on 200 and sends the setup code as the Bearer", async () => {
    let captured: string | null = null;
    server.use(
      http.get("*/oauth/google/connect-url", ({ request }) => {
        captured = request.headers.get("authorization");
        return HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?ok=1" });
      }),
    );
    const { url } = await startGoogleConnect("user-typed-code");
    expect(url).toContain("accounts.google.com");
    expect(captured).toBe("Bearer user-typed-code");
  });

  it("maps 401 to the 'auth' reason (wrong code)", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 401 })),
    );
    await expect(startGoogleConnect("nope")).rejects.toMatchObject({ reason: "auth" });
  });

  it("maps 403 to the 'auth' reason (wrong code), distinct from 429/503", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 403 })),
    );
    await expect(startGoogleConnect("nope")).rejects.toMatchObject({ reason: "auth" });
  });

  it("maps 429 to the distinct 'rate_limited' reason", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 429 })),
    );
    await expect(startGoogleConnect("code")).rejects.toMatchObject({ reason: "rate_limited" });
  });

  it("maps 503 to the distinct 'not_configured' reason (dark)", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 503 })),
    );
    await expect(startGoogleConnect("code")).rejects.toMatchObject({ reason: "not_configured" });
  });

  it("throws a GoogleConnectError instance with the status preserved", async () => {
    server.use(
      http.get("*/oauth/google/connect-url", () => new HttpResponse(null, { status: 500 })),
    );
    const err = await startGoogleConnect("code").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleConnectError);
    expect(err.reason).toBe("unknown");
    expect(err.status).toBe(500);
  });
});

describe("disconnectGoogle (#111)", () => {
  it("resolves on a 204 and sends the setup code as the Bearer", async () => {
    let captured: string | null = null;
    server.use(
      http.post("*/oauth/google/disconnect", ({ request }) => {
        captured = request.headers.get("authorization");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(disconnectGoogle("the-code")).resolves.toBeUndefined();
    expect(captured).toBe("Bearer the-code");
  });

  it("throws a GoogleConnectError on a non-2xx (e.g. 401)", async () => {
    server.use(
      http.post("*/oauth/google/disconnect", () => new HttpResponse(null, { status: 401 })),
    );
    await expect(disconnectGoogle("bad")).rejects.toBeInstanceOf(GoogleConnectError);
  });
});
