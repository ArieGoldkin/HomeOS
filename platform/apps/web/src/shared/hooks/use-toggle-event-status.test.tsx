import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { eventsQueryKey } from "./use-events";
import { useToggleEventStatus } from "./use-toggle-event-status";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useToggleEventStatus", () => {
  it("mutates successfully and returns the updated SavedEvent", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useToggleEventStatus(), { wrapper: makeWrapper(client) });

    result.current.mutate({ id: 1, status: "done" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(1);
    expect(result.current.data?.status).toBe("done");
  });

  it("invalidates the events query on success so the board re-fetches", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useToggleEventStatus(), { wrapper: makeWrapper(client) });

    result.current.mutate({ id: 1, status: "done" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: eventsQueryKey });
  });

  it("surfaces an error when the server rejects (404)", async () => {
    server.use(http.patch("*/events/:id", () => new HttpResponse("Not found", { status: 404 })));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useToggleEventStatus(), { wrapper: makeWrapper(client) });

    result.current.mutate({ id: 999, status: "done" });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
