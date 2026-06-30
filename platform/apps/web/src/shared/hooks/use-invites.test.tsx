import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { useCreateInvite } from "./use-create-invite";
import { invitesQueryKey, useInvites } from "./use-invites";
import { useRevokeInvite } from "./use-revoke-invite";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useInvites", () => {
  it("returns the owner's pending invites on success", async () => {
    const { result } = renderHook(() => useInvites(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.email).toBe("savta@example.com");
  });

  it("lands in error (no retry) when the server 403s — the owner gate", async () => {
    server.use(http.get("*/invites", () => new HttpResponse("Forbidden", { status: 403 })));
    const { result } = renderHook(() => useInvites(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/403/);
  });
});

describe("useCreateInvite", () => {
  it("mutates and invalidates invitesQueryKey on success", async () => {
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateInvite(), { wrapper: makeWrapper(client) });

    result.current.mutate({ email: "new@example.com", role: "member" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.email).toBe("new@example.com");
    expect(spy).toHaveBeenCalledWith({ queryKey: invitesQueryKey });
  });

  it("surfaces a 400 (bad email) as an error", async () => {
    server.use(http.post("*/invites", () => new HttpResponse("Invalid invite", { status: 400 })));
    const { result } = renderHook(() => useCreateInvite(), { wrapper: makeWrapper(makeClient()) });
    result.current.mutate({ email: "nope", role: "member" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/400/);
  });
});

describe("useRevokeInvite", () => {
  it("mutates and invalidates invitesQueryKey on success", async () => {
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRevokeInvite(), { wrapper: makeWrapper(client) });

    result.current.mutate("inv-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: invitesQueryKey });
  });
});
