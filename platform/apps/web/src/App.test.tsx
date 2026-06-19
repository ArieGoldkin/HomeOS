import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("App", () => {
  it("renders the tablet board surface at / (masthead greeting heading)", async () => {
    render(wrap(<App />));
    // The router resolves `/` to TabletBoard → TabletShell's greeting heading (async route mount).
    expect(await screen.findByRole("heading")).toBeInTheDocument();
  });

  it("enforces RTL Hebrew on the document root", async () => {
    render(wrap(<App />));
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.style.getPropertyValue("--draw-origin")).toBe("right center");
  });
});
