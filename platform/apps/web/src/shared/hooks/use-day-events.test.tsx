import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { useDayEvents } from "./use-day-events";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useDayEvents", () => {
  beforeEach(() => {
    // Fake only Date so waitFor's real-timer polling still works; pin to 12:00 Jerusalem on 2026-06-21.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("partitions the selected day and exposes the now clock when that day is today", async () => {
    const { result } = renderHook(() => useDayEvents("2026-06-21", new Date()), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // sample id1: 2026-06-21 18:30 (today, timed)
    expect(result.current.timed.map((e) => e.title_he)).toContain("אסיפת הורים בגן");
    // sample id2: 2026-06-22 (tomorrow peek)
    expect(result.current.tomorrow.map((t) => t.title)).toContain("תור לרופא");
    expect(result.current.nowTime).toBe("12:00");
    expect(result.current.moreCount).toBe(0);
  });

  it("suppresses the now clock when the selected day is not today", async () => {
    const { result } = renderHook(() => useDayEvents("2026-06-22", new Date()), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // No "now" on a non-today day → no NowLine.
    expect(result.current.nowTime).toBeNull();
    // id2 sits on 2026-06-22 but is untimed.
    expect(result.current.untimed.map((e) => e.title_he)).toContain("תור לרופא");
  });

  it("carries an overdue open task onto today's untimed list, ranked first (#20)", async () => {
    const base = {
      kind: "task" as const,
      time: null,
      location: null,
      assignee: null,
      recurrence: null,
      source_text: "",
      source_provider: null,
      status: "open" as const,
    };
    const overdue = { ...base, id: 99, title_he: "מטלה ישנה", date_iso: "2026-06-19" };
    const todayTask = { ...base, id: 1, title_he: "מטלת היום", date_iso: "2026-06-21" };
    server.use(http.get("*/events", () => HttpResponse.json({ events: [todayTask, overdue] })));

    const { result } = renderHook(() => useDayEvents("2026-06-21", new Date()), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    // overdue task carried to the top, then the day's own task
    expect(result.current.untimed.map((e) => e.title_he)).toEqual(["מטלה ישנה", "מטלת היום"]);
  });

  it("reports the error status when /events fails", async () => {
    server.use(http.get("*/events", () => new HttpResponse("Unauthorized", { status: 401 })));
    const { result } = renderHook(() => useDayEvents("2026-06-21", new Date()), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
