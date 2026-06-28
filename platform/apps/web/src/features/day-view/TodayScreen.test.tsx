import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";

// #230 — the greeting name comes from the session; mock it (TodayScreen renders outside <AuthProvider>
// here). "דנה" is deliberately NOT in the mock HOUSEHOLD roster, so finding it proves the greeting is
// session-sourced, not the old CURRENT_USER constant.
vi.mock("@shared/auth", () => ({
  useCurrentUser: () => ({
    status: "authenticated",
    full_name: "דנה לוי",
    email: "dana@example.com",
    avatar_url: null,
  }),
}));

import { TodayScreen } from "./TodayScreen";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("TodayScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T06:00:00Z")); // 09:00 Jerusalem → "בוקר טוב"
  });
  afterEach(() => vi.useRealTimers());

  it("greets the signed-in user by their session first name (#230)", () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    expect(screen.getByText("בוקר טוב,", { exact: false })).toBeInTheDocument();
    // First name from the session full_name "דנה לוי" — renders in the accent span.
    expect(screen.getByText("דנה")).toBeInTheDocument();
  });

  it("shows the tasks-left chip and the server-driven household card (#235)", async () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    expect(screen.getByText(/משימות היום/)).toBeInTheDocument();
    expect(screen.getByText("משק הבית")).toBeInTheDocument();
    // The roster + count now come from GET /family (4 members in the default msw handler), not a mock.
    await waitFor(() => expect(screen.getByText("4 בני בית")).toBeInTheDocument());
    expect(screen.getByText("אבא")).toBeInTheDocument();
  });

  it("renders the data-connected schedule (today's event)", async () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
  });

  it("opens the add-task modal from the action chip", async () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    fireEvent.click(screen.getByRole("button", { name: "+ משימה חדשה" }));
    // The AddEvent modal mounts a dialog when opened.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  // #25 — the header shows the Hebrew date + an Israeli holiday chip for the displayed day.
  it("shows a holiday chip + Hebrew date for a holiday day", async () => {
    render(wrap(<TodayScreen dateIso="2026-05-22" />)); // Shavuot 5786
    await waitFor(() => expect(screen.getByText("שבועות")).toBeInTheDocument());
  });

  // #19 — the done-toggle is wired end-to-end: an untimed task renders a checkbox whose click PATCHes
  // /events/:id with the flipped status.
  it("toggles a task done via the checkbox (PATCH /events/:id)", async () => {
    const task = {
      id: 5,
      kind: "task",
      title_he: "לקנות חלב",
      date_iso: "2026-06-21",
      time: null,
      location: null,
      assignee: null,
      recurrence: null,
      source_text: "",
      source_provider: null,
      status: "open",
    };
    let patched: { id: string; status: string } | undefined;
    server.use(
      http.get("*/events", () => HttpResponse.json({ events: [task] })),
      http.patch("*/events/:id", async ({ request, params }) => {
        const body = (await request.json()) as { status: string };
        patched = { id: String(params.id), status: body.status };
        return HttpResponse.json({ ...task, status: body.status }, { status: 200 });
      }),
    );

    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    await waitFor(() => expect(screen.getByText("לקנות חלב")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /סמן כבוצע/ }));
    await waitFor(() => expect(patched).toEqual({ id: "5", status: "done" }));
  });
});
