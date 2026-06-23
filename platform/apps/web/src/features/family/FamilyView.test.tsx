import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { FamilyView } from "./FamilyView";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const INVITE = "+ הזמנת בן בית";

describe("FamilyView (People, data-connected)", () => {
  it("renders the household header + a data table of the known roster", async () => {
    render(wrap(<FamilyView />));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("הבית");
    await waitFor(() => expect(screen.getByText("אבא")).toBeInTheDocument());
    for (const name of ["אמא", "יואב", "נועה"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const col of ["שם", "סטטוס", "תפקיד"]) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
    expect(screen.getAllByText("הורה").length).toBeGreaterThanOrEqual(2); // אבא + אמא
  });

  it("shows the household-count stat chip", async () => {
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText(/בני בית/)).toBeInTheDocument());
  });

  it("derives a new assignee from events into the roster", async () => {
    server.use(
      http.get("*/events", () =>
        HttpResponse.json({
          events: [
            {
              id: 5,
              kind: "task",
              title_he: "מטלה",
              date_iso: "2026-06-21",
              time: null,
              location: null,
              assignee: "סבתא",
              recurrence: null,
              source_text: "x",
              source_provider: null,
            },
          ],
        }),
      ),
    );
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText("סבתא")).toBeInTheDocument());
    expect(screen.getByText("אבא")).toBeInTheDocument();
  });

  it("shows the invite button", async () => {
    render(wrap(<FamilyView />));
    expect(screen.getByRole("button", { name: INVITE })).toBeInTheDocument();
  });

  it("shows the error message when the events request fails", async () => {
    server.use(http.get("*/events", () => new HttpResponse("Unauthorized", { status: 401 })));
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText(/שגיאה בטעינת הרשימה/)).toBeInTheDocument());
  });

  it("fires onAddMember when the invite button is clicked", async () => {
    const onAddMember = vi.fn();
    render(wrap(<FamilyView onAddMember={onAddMember} />));
    await userEvent.click(screen.getByRole("button", { name: INVITE }));
    expect(onAddMember).toHaveBeenCalledOnce();
  });
});
