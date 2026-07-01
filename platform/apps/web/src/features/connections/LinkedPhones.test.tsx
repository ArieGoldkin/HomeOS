import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { LinkedPhones } from "./LinkedPhones";

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<LinkedPhones />, { wrapper: Wrapper });
}

describe("LinkedPhones (#262 — owner-gated phone-revocation card)", () => {
  it("renders the card with the family's bound phones (success)", async () => {
    renderCard();
    expect(await screen.findByTestId("linked-phones")).toBeInTheDocument();
    expect(screen.getByText("+972501234567")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניתוק המספר 972501234567" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no bound phones", async () => {
    server.use(http.get("*/phones", () => HttpResponse.json({ phones: [] })));
    renderCard();
    expect(await screen.findByText("אין מספרים מורשים.")).toBeInTheDocument();
  });

  it("renders NOTHING when the query 403s (a non-owner — the capability gate)", async () => {
    server.use(http.get("*/phones", () => new HttpResponse("Forbidden", { status: 403 })));
    renderCard();
    await waitFor(() => expect(screen.queryByTestId("linked-phones")).not.toBeInTheDocument());
  });

  it("shows an error notice (NOT hidden) on a non-403 failure — a real owner's transient blip", async () => {
    server.use(http.get("*/phones", () => new HttpResponse("Server Error", { status: 500 })));
    renderCard();
    expect(await screen.findByTestId("linked-phones")).toBeInTheDocument();
    expect(screen.getByText("שגיאה בטעינת המספרים — ננסה שוב בקרוב.")).toBeInTheDocument();
  });

  it("confirm-before-destroy: unbinds (DELETE by from_phone) only after the inline אישור", async () => {
    let unboundPhone: string | undefined;
    server.use(
      http.delete("*/phones/:phone", ({ params }) => {
        unboundPhone = params.phone as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await screen.findByText("+972501234567");
    // First click reveals the confirm — it does NOT delete yet.
    await user.click(screen.getByRole("button", { name: "ניתוק המספר 972501234567" }));
    expect(screen.getByText("לנתק?")).toBeInTheDocument();
    expect(unboundPhone).toBeUndefined();

    // Confirming fires the DELETE keyed on the digit-normalized from_phone.
    await user.click(screen.getByRole("button", { name: "אישור ניתוק המספר 972501234567" }));
    await waitFor(() => expect(unboundPhone).toBe("972501234567"));
  });

  it("the inline ביטול cancels the confirm without deleting", async () => {
    let deleteCalled = false;
    server.use(
      http.delete("*/phones/:phone", () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await screen.findByText("+972501234567");
    await user.click(screen.getByRole("button", { name: "ניתוק המספר 972501234567" }));
    await user.click(screen.getByRole("button", { name: "ביטול הניתוק של המספר 972501234567" }));

    // The confirm is gone and no DELETE was issued.
    expect(screen.queryByText("לנתק?")).not.toBeInTheDocument();
    expect(deleteCalled).toBe(false);
  });
});
