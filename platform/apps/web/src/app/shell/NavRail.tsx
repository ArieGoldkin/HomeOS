import { cn } from "@shared/lib";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" {...strokeProps}>
      {children}
    </svg>
  );
}

/**
 * The single source of truth for the app's primary navigation — rendered as the desktop icon RAIL and
 * the mobile bottom BAR. Hebrew labels; flat top-level routes (the surface split is gone). `to` is
 * `as const` so each literal is checked against the typed route tree.
 */
const NAV = [
  {
    to: "/today",
    label: "היום",
    icon: (
      <Glyph>
        <path d="M3.2 11 12 3.5 20.8 11" />
        <path d="M5.4 9.3V20h13.2V9.3" />
        <path d="M9.7 20v-5.2h4.6V20" />
      </Glyph>
    ),
  },
  {
    to: "/calendar",
    label: "יומן",
    icon: (
      <Glyph>
        <rect x="3.8" y="5" width="16.4" height="15" rx="2.6" />
        <path d="M3.8 9.4h16.4" />
        <path d="M8 3.2v3M16 3.2v3" />
      </Glyph>
    ),
  },
  {
    to: "/people",
    label: "אנשים",
    icon: (
      <Glyph>
        <circle cx="9" cy="8.4" r="3.1" />
        <path d="M3.4 19.2c0-3.1 2.5-5.4 5.6-5.4s5.6 2.3 5.6 5.4" />
        <path d="M16.2 5.6c1.7.2 3 1.7 3 3.5 0 1.2-.6 2.3-1.5 2.9M17.4 13.9c2.2.4 3.8 2.2 3.8 4.6" />
      </Glyph>
    ),
  },
  {
    to: "/lists",
    label: "רשימות",
    icon: (
      <Glyph>
        <path d="M4 6.5l1.4 1.4L8 5.3" />
        <path d="M4 17.5l1.4 1.4L8 16.3" />
        <path d="M11 7h9M11 12h9M11 17h9" />
      </Glyph>
    ),
  },
  {
    to: "/connections",
    label: "חיבורים",
    icon: (
      <Glyph>
        <path d="M20 11.4a7.6 7.6 0 0 1-11 6.8L4.5 19.5l1.3-4.4A7.6 7.6 0 1 1 20 11.4z" />
      </Glyph>
    ),
  },
  {
    to: "/settings",
    label: "הגדרות",
    icon: (
      <Glyph>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="2.4" />
        <circle cx="15" cy="17" r="2.4" />
      </Glyph>
    ),
  },
] as const;

/** The desktop left icon rail (≥md). Active item carries the green wash; tooltips via `title`. */
export function NavRail({ className }: { className?: string }) {
  return (
    <nav
      aria-label="ניווט ראשי"
      className={cn(
        "w-[66px] shrink-0 flex-col items-center gap-1.5 border-[var(--rail-border)] border-e bg-rail py-3",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="mb-2 grid size-[34px] place-items-center rounded-[10px] bg-primary"
      >
        <span className="size-[11px] rotate-45 rounded-[3px] bg-background" />
      </div>
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          title={item.label}
          aria-label={item.label}
          className="grid size-[42px] place-items-center rounded-xl text-glyph transition-colors hover:bg-secondary"
          activeProps={{ className: "bg-nav-active text-primary", "aria-current": "page" }}
        >
          {item.icon}
        </Link>
      ))}
    </nav>
  );
}

/** The mobile bottom bar (<md). Same items + source as the rail; icon over label. */
export function BottomNav({ className }: { className?: string }) {
  return (
    <nav
      aria-label="ניווט ראשי"
      className={cn(
        "fixed inset-x-0 bottom-0 z-10 items-stretch justify-around border-[var(--rail-border)] border-t bg-rail",
        className,
      )}
    >
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-label={item.label}
          className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] text-glyph"
          activeProps={{ className: "text-primary", "aria-current": "page" }}
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
