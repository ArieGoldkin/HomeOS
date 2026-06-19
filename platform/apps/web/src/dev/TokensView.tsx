// Dev-only swatch gallery to eyeball the "Ocean × Rubik" tokens (globals.css).
// Reached at #/tokens. Not part of the product surfaces.
const SWATCHES = [
  { name: "background", token: "--background" },
  { name: "card", token: "--card" },
  { name: "foreground", token: "--foreground" },
  { name: "primary (ocean)", token: "--primary" },
  { name: "muted-foreground", token: "--muted-foreground" },
  { name: "border", token: "--border" },
  { name: "wa-green", token: "--wa-green" },
] as const;

export function TokensView() {
  return (
    <main className="paper-grain min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="font-display text-2xl font-bold">Ocean × Rubik — tokens</h1>
        <p className="mt-1 text-sm text-muted-foreground">dev-only swatch gallery</p>

        <ul className="mt-6 grid gap-3">
          {SWATCHES.map((s) => (
            <li key={s.token} className="flex items-center gap-3">
              <span
                className="size-10 rounded-md border border-border"
                style={{ background: `var(${s.token})` }}
              />
              <span className="font-medium">{s.name}</span>
              <code className="text-sm text-muted-foreground">{s.token}</code>
            </li>
          ))}
        </ul>

        {/* anti-slop reminder sample: an ocean PIP + primary-colored title — never a colored left-border */}
        <div className="mt-8 flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary" />
          <span className="font-medium text-primary">תזכורת — reminder (ocean pip)</span>
        </div>
      </div>
    </main>
  );
}
