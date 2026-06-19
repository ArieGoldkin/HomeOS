import { useEffect } from "react";
import { TokensView } from "./dev/TokensView";

/**
 * MVP shell. No router yet (TanStack Router lands at #96). The dev-only token
 * gallery renders at `#/tokens`; everything else is a minimal placeholder until
 * the tablet board (#93–#95) lands.
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

  return (
    <main className="paper-grain min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-md p-6">
        <h1 className="font-display text-2xl font-bold">HomeOS</h1>
        <p className="mt-2 text-muted-foreground">לוח המשפחה — בקרוב.</p>
        <a className="mt-4 inline-block text-primary underline" href="#/tokens">
          ← /tokens
        </a>
      </div>
    </main>
  );
}
