import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { ConnectWhatsAppCard } from "./ConnectWhatsAppCard";

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ConnectWhatsAppCard />, { wrapper: Wrapper });
}

describe("ConnectWhatsAppCard (#228 — the wa.me binding card)", () => {
  it("renders the card with a get-code button; no code fetched until the button is clicked", async () => {
    renderCard();
    expect(await screen.findByTestId("connect-whatsapp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קבלת קוד חיבור" })).toBeInTheDocument();
    expect(screen.queryByTestId("binding-code")).not.toBeInTheDocument();
  });

  it("mints a code on click and renders it + a wa.me deep link with the digits-only number and prefilled code", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "קבלת קוד חיבור" }));

    expect(await screen.findByTestId("binding-code")).toHaveTextContent("HOME-ABCDE");
    const link = screen.getByRole("link", { name: "פתיחת וואטסאפ ושליחת הקוד" });
    // botPhone "+972 50-123 4567" → digits-only 972501234567; the code rides in the prefilled ?text=.
    expect(link).toHaveAttribute(
      "href",
      `https://wa.me/972501234567?text=${encodeURIComponent("קוד חיבור HomeOS: HOME-ABCDE")}`,
    );
  });

  it("degrades gracefully when the server has no bot number (botPhone null): code shown, no wa.me link", async () => {
    server.use(http.get("*/channel", () => HttpResponse.json({ botPhone: null })));
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "קבלת קוד חיבור" }));

    expect(await screen.findByTestId("binding-code")).toHaveTextContent("HOME-ABCDE");
    expect(
      screen.queryByRole("link", { name: "פתיחת וואטסאפ ושליחת הקוד" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("שלחו את ההודעה למספר הבוט של HomeOS מהוואטסאפ שלכם."),
    ).toBeInTheDocument();
  });

  it("shows an error notice when minting fails (e.g. a viewer's 403)", async () => {
    server.use(http.post("*/binding", () => new HttpResponse("Forbidden", { status: 403 })));
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "קבלת קוד חיבור" }));

    expect(await screen.findByText("לא הצלחנו ליצור קוד חיבור. נסו שוב.")).toBeInTheDocument();
    expect(screen.queryByTestId("binding-code")).not.toBeInTheDocument();
  });
});
