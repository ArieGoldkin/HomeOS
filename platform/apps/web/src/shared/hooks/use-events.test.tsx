import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { useEvents } from "./use-events";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useEvents", () => {
  it("returns typed SavedEvent[] from the wrapped payload", async () => {
    const { result } = renderHook(() => useEvents(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it("surfaces an error state on 401", async () => {
    server.use(http.get("*/events", () => new HttpResponse("Unauthorized", { status: 401 })));
    const { result } = renderHook(() => useEvents(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
