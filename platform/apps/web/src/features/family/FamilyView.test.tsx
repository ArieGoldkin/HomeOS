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
  it("renders the household header + a data table of the real GET /family roster", async () => {
    render(wrap(<FamilyView />));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("בני הבית");
    await waitFor(() => expect(screen.getByText("אבא")).toBeInTheDocument());
    for (const name of ["אמא", "יואב", "נועה"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Columns are name + role only — the fake "סטטוס"/"פעיל" presence column is gone.
    for (const col of ["שם", "תפקיד"]) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
    expect(screen.queryByText("סטטוס")).not.toBeInTheDocument();
    expect(screen.queryByText("פעיל")).not.toBeInTheDocument();
    // Honest role from the server ownership axis: אבא is the owner (בעלים), the rest are household members.
    expect(screen.getByText("בעלים")).toBeInTheDocument();
    expect(screen.getAllByText("בן בית")).toHaveLength(3); // אמא + יואב + נועה
  });

  it("shows the household-count stat chip", async () => {
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText(/בני בית/)).toBeInTheDocument());
  });

  it("does NOT fabricate members from event assignees — the roster is only GET /family (honest roster)", async () => {
    // Even with an event assigned to a non-member (סבתא), the People roster must not list them as a member.
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
    await waitFor(() => expect(screen.getByText("אבא")).toBeInTheDocument()); // a real member renders
    expect(screen.queryByText("סבתא")).not.toBeInTheDocument(); // an event-only assignee is NOT a member
  });

  it("renders members from the GET /family payload, not a hardcoded list (#235 un-mock)", async () => {
    server.use(
      http.get("*/family", () =>
        HttpResponse.json({
          family: { display_name: "משפחה" },
          members: [{ name: "דנה", role: "owner" }],
        }),
      ),
    );
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText("דנה")).toBeInTheDocument());
    expect(screen.queryByText("יואב")).not.toBeInTheDocument(); // was a hardcoded KNOWN_ROSTER name pre-#235
  });

  it("shows the invite button", async () => {
    render(wrap(<FamilyView />));
    expect(screen.getByRole("button", { name: INVITE })).toBeInTheDocument();
  });

  it("shows the error message when the roster request fails (#235 — keyed on GET /family, not events)", async () => {
    server.use(http.get("*/family", () => new HttpResponse("Unauthorized", { status: 401 })));
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
