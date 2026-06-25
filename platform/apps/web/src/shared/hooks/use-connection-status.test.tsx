import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { googleConnectedHandler, googleDarkHandler } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { GoogleNotConfiguredError } from "../api/google";
import { googleStatusQueryKey, useConnectionStatus } from "./use-connection-status";

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("useConnectionStatus (#111)", () => {
  it("returns the default not-connected status", async () => {
    const { result } = renderHook(() => useConnectionStatus(), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.connected).toBe(false);
  });

  it("returns the connected status (scopes + expiresAt) when overridden", async () => {
    server.use(googleConnectedHandler());
    const { result } = renderHook(() => useConnectionStatus(), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.connected).toBe(true);
  });

  it("surfaces the 503 dark state as a GoogleNotConfiguredError", async () => {
    server.use(googleDarkHandler());
    const { result } = renderHook(() => useConnectionStatus(), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(GoogleNotConfiguredError);
  });

  it("is invalidatable on the ['google','status'] key (refetches after connect/disconnect)", async () => {
    const client = freshClient();
    const { result } = renderHook(() => useConnectionStatus(), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.connected).toBe(false);

    // Simulate a successful connect: the server now reports connected, then we invalidate the key.
    server.use(googleConnectedHandler());
    await client.invalidateQueries({ queryKey: googleStatusQueryKey });
    await waitFor(() => expect(result.current.data?.connected).toBe(true));
  });
});
