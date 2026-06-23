// Design-system faces (#171). Hebrew-first: Heebo (sans) + Frank Ruhl Libre (accent serif).
// Schibsted Grotesk + Newsreader are the English swap (dormant until the EN toggle ships);
// Spline Sans Mono is the caption/label mono. All self-hosted, subset by unicode-range.
import "@fontsource-variable/heebo";
import "@fontsource-variable/frank-ruhl-libre";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/spline-sans-mono";
import "./styles/globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const queryClient = new QueryClient();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
