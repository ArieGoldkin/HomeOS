import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { requestBindingCode } from "./binding";

describe("requestBindingCode", () => {
  it("posts and returns the minted code from the { code } payload", async () => {
    await expect(requestBindingCode()).resolves.toBe("HOME-ABCDE");
  });

  it("rejects a malformed payload (a missing { code } envelope)", async () => {
    server.use(http.post("*/binding", () => HttpResponse.json({ wrong: 1 })));
    await expect(requestBindingCode()).rejects.toThrow();
  });

  it("throws on a 403 (a viewer — binding is writer-only)", async () => {
    server.use(http.post("*/binding", () => new HttpResponse("Forbidden", { status: 403 })));
    await expect(requestBindingCode()).rejects.toThrow(/403/);
  });

  it("throws on a 503 (binding store unwired)", async () => {
    server.use(
      http.post("*/binding", () => new HttpResponse("Binding not configured", { status: 503 })),
    );
    await expect(requestBindingCode()).rejects.toThrow(/503/);
  });

  it("sends the session cookie (credentials: include) and no Authorization header", async () => {
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.post("*/binding", ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ code: "HOME-ABCDE" }, { status: 201 });
      }),
    );
    await requestBindingCode();
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });
});
