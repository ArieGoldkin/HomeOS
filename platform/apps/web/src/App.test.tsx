import { ThemeProvider } from "@shared/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{node}</ThemeProvider>
    </QueryClientProvider>
  );
}

describe("App", () => {
  it("boots into the responsive AppShell (/ → /today)", async () => {
    render(wrap(<App />));
    // `/` redirects to /today; the AppShell chrome mounts (the render-only command-bar placeholder).
    expect(await screen.findByText("איך אפשר לעזור היום?")).toBeInTheDocument();
  });

  it("opens the Add dialog from the mobile floating action button", async () => {
    render(wrap(<App />));
    await screen.findByText("איך אפשר לעזור היום?"); // shell mounted
    // Two Add triggers render: the desktop header button (hidden md:grid) and the mobile FAB
    // (md:hidden). jsdom ignores the responsive classes, so both are in the DOM here.
    const addTriggers = screen.getAllByRole("button", { name: "הוספה ללוח" });
    expect(addTriggers).toHaveLength(2);
    // The FAB renders last (after the bottom nav); clicking it opens the same AddEventDialog.
    const fab = addTriggers[addTriggers.length - 1];
    if (!fab) throw new Error("expected a floating Add trigger");
    fireEvent.click(fab);
    expect(await screen.findByText("כותרת")).toBeInTheDocument(); // a field only present when the dialog is open
  });

  it("enforces RTL Hebrew on the document root", async () => {
    render(wrap(<App />));
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.style.getPropertyValue("--draw-origin")).toBe("right center");
  });
});
