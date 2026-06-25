import { AddEventDialog } from "@features/add-event";
import { PersonAvatar } from "@shared/board";
import { useTheme } from "@shared/theme";
import { IconButton } from "@shared/ui";
import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { BottomNav, NavRail } from "./NavRail";

/**
 * The ONE responsive app shell (replaces the tablet/phone/web shells). A 66px left icon rail at ≥md
 * collapses to a fixed bottom bar below md (both render — CSS-toggled — so tests are deterministic and
 * there's no JS surface-detection). The top header carries the wordmark, a render-only command-bar
 * placeholder (the agent wiring is a deferred follow-up), the light/dark toggle, a first-run link, an
 * Add button, and the avatar. Screens render through the <Outlet/> in a centred max-w column.
 */
export function AppShell() {
  const { theme, toggle } = useTheme();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="paper-grain flex h-dvh overflow-hidden text-foreground">
      <NavRail className="hidden md:flex" />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[58px] flex-none items-center gap-3 border-[var(--header-border)] border-b px-4 md:px-6">
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="font-bold text-[16px] text-[color:var(--ink)] tracking-tight">
              HomeOS
            </span>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              משפחה
            </span>
          </div>

          {/* Command bar is a non-functional placeholder (agent wiring deferred) — DESKTOP ONLY so it
              never eats the cramped phone row (it was the flex-1 block that pushed the avatar off-edge). */}
          <div className="hidden flex-1 justify-center md:flex">
            <div className="flex min-w-0 max-w-[400px] items-center gap-2 rounded-full border border-[var(--cmd-border)] bg-[var(--cmd-bg)] px-4 py-2">
              <span aria-hidden="true" className="text-primary">
                ✦
              </span>
              <span className="truncate font-accent text-[14px] text-[color:var(--cmd-text)]">
                איך אפשר לעזור היום?
              </span>
            </div>
          </div>

          {/* Mobile-only spacer: pushes the theme+avatar cluster to the logical end once the command bar is hidden. */}
          <div className="flex-1 md:hidden" />

          <button
            type="button"
            onClick={toggle}
            aria-label="החלפת ערכת נושא"
            className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-[var(--header-border)] text-[15px] text-ink-soft transition-colors hover:bg-secondary"
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>

          <Link
            to="/welcome"
            className="hidden rounded-[9px] border border-[var(--header-border)] px-3 py-1.5 font-semibold text-[12px] text-ink-soft transition-colors hover:bg-secondary sm:inline-block"
          >
            התחלה
          </Link>

          {/* Header Add — DESKTOP ONLY; mobile uses the floating action button below. */}
          <IconButton
            aria-label="הוספה ללוח"
            variant="primary"
            onClick={() => setAddOpen(true)}
            className="hidden md:grid"
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              +
            </span>
          </IconButton>

          <PersonAvatar name="מאיה" size={34} className="shrink-0" />
        </header>

        <main className="flex-1 overflow-y-auto px-4 pt-6 pb-24 md:px-8 md:pb-8">
          <div className="mx-auto max-w-[1040px]">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomNav className="flex md:hidden" />

      {/* Mobile primary action — a floating Add button at the logical-end corner (RTL: bottom-left),
          floating ABOVE the bottom bar (bottom-20 clears it). md:hidden — desktop keeps the header Add. */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        aria-label="הוספה ללוח"
        className="fixed end-4 bottom-20 z-20 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-float transition hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:active:scale-100 md:hidden"
      >
        <span aria-hidden="true" className="text-2xl leading-none">
          +
        </span>
      </button>

      <AddEventDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
