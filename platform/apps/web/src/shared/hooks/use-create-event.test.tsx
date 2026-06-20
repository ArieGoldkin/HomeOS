import type { ParsedEvent } from "@homeos/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useCreateEvent } from "./use-create-event";
import { eventsQueryKey } from "./use-events";

/** A valid ParsedEvent fixture — source_text is required by parsedEventSchema. */
const parsedFixture: ParsedEvent = {
  kind: "event",
  title_he: "בדיקה",
  date_iso: "2026-06-21",
  time: "10:00",
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "נוסף ידנית",
};

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useCreateEvent", () => {
  it("mutates successfully and returns the SavedEvent (id 999)", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useCreateEvent(), {
      wrapper: makeWrapper(client),
    });

    result.current.mutate(parsedFixture);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe(999);
    expect(result.current.data?.title_he).toBe("בדיקה");
    expect(result.current.data?.source_provider).toBeNull();
  });

  it("invalidates eventsQueryKey on success", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useCreateEvent(), {
      wrapper: makeWrapper(client),
    });

    result.current.mutate(parsedFixture);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: eventsQueryKey });
  });

  it("exposes the error when the server returns a non-2xx status", async () => {
    const { server } = await import("../../test/msw/server");
    const { HttpResponse, http } = await import("msw");

    server.use(http.post("*/events", () => new HttpResponse("Server Error", { status: 500 })));

    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useCreateEvent(), {
      wrapper: makeWrapper(client),
    });

    result.current.mutate(parsedFixture);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/POST \/events failed \(500\)/);
  });
});
