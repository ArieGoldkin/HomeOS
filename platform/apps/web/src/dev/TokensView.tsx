// Dev-only gallery to eyeball the "Warm Paper × Living Green" design system (globals.css): the
// palette, the 3 card surfaces, the 3 font roles, and the button variants. Reached at #/tokens —
// not a product surface. The light/dark toggle re-scopes `data-theme` onto THIS view only (local
// state, not the shared ThemeProvider), so a dev can preview both themes without flipping the app.
import { Button, Card, SectionLabel } from "@shared/ui";
import { useState } from "react";

const PALETTE = [
  { name: "paper", token: "--background" },
  { name: "ink", token: "--foreground" },
  { name: "primary · living green", token: "--primary" },
  { name: "secondary · muted beige", token: "--secondary" },
  { name: "blue", token: "--blue" },
  { name: "violet", token: "--violet" },
  { name: "coral", token: "--coral" },
  { name: "spark", token: "--spark" },
  { name: "destructive", token: "--destructive" },
  { name: "wa-green", token: "--wa-green" },
] as const;

const BUTTON_VARIANTS = ["primary", "ink", "ghost", "dashed"] as const;

export function TokensView() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  return (
    <main
      data-theme={theme}
      data-testid="tokens-root"
      className="paper-grain min-h-dvh text-foreground"
      style={{ background: "var(--app-bg)", backgroundAttachment: "fixed" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              design tokens · globals.css
            </div>
            <h1 className="mt-2 font-display text-[30px] font-extrabold leading-[1.05] tracking-tight text-[color:var(--ink)]">
              Warm Paper{" "}
              <span className="font-accent font-medium text-primary">× Living Green</span>
            </h1>
          </div>
          <Button variant="ink" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}>
            תצוגה: {theme === "light" ? "בהיר" : "כהה"}
          </Button>
        </header>

        <section className="flex flex-col gap-3">
          <SectionLabel>צבעים · palette</SectionLabel>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PALETTE.map((s) => (
              <li key={s.token} className="flex items-center gap-3">
                <span
                  className="size-9 rounded-md border border-border"
                  style={{ background: `var(${s.token})` }}
                />
                <span className="text-[14px] font-medium">{s.name}</span>
                <code className="text-[12px] text-muted-foreground">{s.token}</code>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>משטחים · surfaces</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <div className="text-[13px] font-medium">surface</div>
              <p className="mt-1 text-[12px] text-muted-foreground">white content card</p>
            </Card>
            <Card variant="muted" className="p-4">
              <div className="text-[13px] font-medium">muted</div>
              <p className="mt-1 text-[12px] text-muted-foreground">beige grouping card</p>
            </Card>
            <Card variant="glass" className="p-4">
              <div className="text-[13px] font-medium">glass</div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                dark translucent — toggle dark
              </p>
            </Card>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>טיפוגרפיה · type roles</SectionLabel>
          <Card className="flex flex-col gap-3.5 p-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                font-sans · Heebo
              </div>
              <p className="font-sans text-[18px]">בוקר טוב — היום יש שלושה אירועים</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                font-accent · Frank Ruhl (upright he / italic en)
              </div>
              <p className="font-accent text-[22px] text-primary">מאיה</p>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                font-mono · Spline Sans Mono
              </div>
              <p className="tnum font-mono text-[16px]">09:00 · 17:30 · 2026</p>
            </div>
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>כפתורים · button variants</SectionLabel>
          <div className="flex flex-wrap gap-2.5">
            {BUTTON_VARIANTS.map((v) => (
              <Button key={v} variant={v}>
                {v}
              </Button>
            ))}
          </div>
        </section>

        {/* anti-slop reminder sample: a GREEN pip + primary-colored title — never a colored left-border */}
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary" />
          <span className="font-medium text-primary">
            תזכורת — reminder (green pip, never a colored border)
          </span>
        </div>
      </div>
    </main>
  );
}
