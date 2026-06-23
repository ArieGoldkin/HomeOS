import { ThemeProvider } from "@shared/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("enforces RTL Hebrew on the document root", async () => {
    render(wrap(<App />));
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.style.getPropertyValue("--draw-origin")).toBe("right center");
  });
});
