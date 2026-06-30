import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { sampleInvites } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { createInvite, fetchInvites, revokeInvite } from "./invites";

describe("fetchInvites", () => {
  it("reads { invites } from the wrapped payload and validates it", async () => {
    const invites = await fetchInvites();
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      email: "savta@example.com",
      role: "member",
      status: "pending",
    });
  });

  it("throws on a 403 (the owner gate — a non-owner can't list invites)", async () => {
    server.use(http.get("*/invites", () => new HttpResponse("Forbidden", { status: 403 })));
    await expect(fetchInvites()).rejects.toThrow(/403/);
  });

  it("rejects a malformed payload (a leaked token field is not the cause, a missing envelope is)", async () => {
    server.use(http.get("*/invites", () => HttpResponse.json({ wrong: [] })));
    await expect(fetchInvites()).rejects.toThrow();
  });

  it("sends the session cookie (credentials: include) and no Authorization header", async () => {
    let credentials: RequestCredentials | undefined;
    let authHeader: string | null = null;
    server.use(
      http.get("*/invites", ({ request }) => {
        credentials = request.credentials;
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ invites: sampleInvites });
      }),
    );
    await fetchInvites();
    expect(credentials).toBe("include");
    expect(authHeader).toBeNull();
  });
});

describe("createInvite", () => {
  it("posts the request and returns the minted invite", async () => {
    const invite = await createInvite({ email: "new@example.com", role: "member" });
    expect(invite).toMatchObject({ email: "new@example.com", role: "member", status: "pending" });
    expect(invite.invite_id).toBe("inv-new");
  });

  it("throws on a 400 (bad email rejected server-side)", async () => {
    server.use(http.post("*/invites", () => new HttpResponse("Invalid invite", { status: 400 })));
    await expect(createInvite({ email: "nope", role: "member" })).rejects.toThrow(/400/);
  });

  it("throws on a 403 (non-owner)", async () => {
    server.use(http.post("*/invites", () => new HttpResponse("Forbidden", { status: 403 })));
    await expect(createInvite({ email: "x@example.com", role: "member" })).rejects.toThrow(/403/);
  });
});

describe("revokeInvite", () => {
  it("resolves on a 204", async () => {
    await expect(revokeInvite("inv-1")).resolves.toBeUndefined();
  });

  it("throws on a 404 (unknown / cross-family id)", async () => {
    server.use(http.delete("*/invites/:id", () => new HttpResponse("Not found", { status: 404 })));
    await expect(revokeInvite("nope")).rejects.toThrow(/404/);
  });
});
