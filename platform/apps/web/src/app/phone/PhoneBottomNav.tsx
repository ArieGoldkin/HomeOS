import { Link } from "@tanstack/react-router";

/** The four phone tabs. Hebrew labels; week starts Sunday so "היום/שבוע" read right-to-left. */
const TABS = [
  { to: "/phone/today", label: "היום" },
  { to: "/phone/week", label: "שבוע" },
  { to: "/phone/family", label: "משפחה" },
  { to: "/phone/settings", label: "הגדרות" },
] as const;

/**
 * The fixed bottom tab bar. Each tab is a typed router Link; the active tab is primary-colored via
 * activeProps (TanStack concatenates base + active className). Lives inside PhoneShell.
 */
export function PhoneBottomNav() {
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md items-stretch justify-around border-border border-t bg-card"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[12px]"
          activeProps={{ className: "font-semibold text-primary", "aria-current": "page" }}
          inactiveProps={{ className: "text-muted-foreground" }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
