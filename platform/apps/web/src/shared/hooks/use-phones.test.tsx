import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { familyQueryKey } from "./use-family";
import { phonesQueryKey, usePhones } from "./use-phones";
import { useUnbindPhone } from "./use-unbind-phone";

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

describe("usePhones", () => {
  it("returns the family's bound phones on success", async () => {
    const { result } = renderHook(() => usePhones(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.from_phone).toBe("972501234567");
  });

  it("lands in error (no retry) when the server 403s — the owner gate", async () => {
    server.use(http.get("*/phones", () => new HttpResponse("Forbidden", { status: 403 })));
    const { result } = renderHook(() => usePhones(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/403/);
  });
});

describe("useUnbindPhone", () => {
  it("mutates and invalidates BOTH phonesQueryKey and familyQueryKey on success", async () => {
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUnbindPhone(), { wrapper: makeWrapper(client) });

    result.current.mutate("972501234567");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The unbound number drops from the list AND the family's whatsappConnected status must refresh.
    expect(spy).toHaveBeenCalledWith({ queryKey: phonesQueryKey });
    expect(spy).toHaveBeenCalledWith({ queryKey: familyQueryKey });
  });

  it("a 404 (already-unbound) SUCCEEDS idempotently and still invalidates (the stale row drops)", async () => {
    server.use(
      http.delete("*/phones/:phone", () => new HttpResponse("Not found", { status: 404 })),
    );
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUnbindPhone(), { wrapper: makeWrapper(client) });
    result.current.mutate("972500000000");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: phonesQueryKey });
  });

  it("surfaces a REAL failure (500) as an error", async () => {
    server.use(
      http.delete("*/phones/:phone", () => new HttpResponse("Server Error", { status: 500 })),
    );
    const { result } = renderHook(() => useUnbindPhone(), { wrapper: makeWrapper(makeClient()) });
    result.current.mutate("972501234567");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/500/);
  });
});
