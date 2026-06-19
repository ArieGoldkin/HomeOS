import { TabletBoard } from "@app/tablet";
import { useEffect } from "react";
import { TokensView } from "./dev/TokensView";

/**
 * MVP entry. No router yet (TanStack Router lands at #96): the default surface is the tablet board
 * (#95), and the dev-only token gallery renders at `#/tokens`. QueryClientProvider lives in main.tsx.
 */
export function App() {
  useEffect(() => {
    // RTL Hebrew is set in index.html; enforce defensively + set the RTL-aware draw origin
    // that the RuleBar/draw-rule motion reads.
    const html = document.documentElement;
    html.setAttribute("dir", "rtl");
    html.setAttribute("lang", "he");
    html.style.setProperty("--draw-origin", "right center");
  }, []);

  const showTokens = typeof window !== "undefined" && window.location.hash === "#/tokens";
  if (showTokens) return <TokensView />;

  return <TabletBoard />;
}
