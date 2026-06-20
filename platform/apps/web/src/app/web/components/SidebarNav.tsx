import { Link } from "@tanstack/react-router";

/** The five web tabs (one more than phone — web adds Connections). Hebrew labels; week starts Sunday. */
const TABS = [
  { to: "/web/today", label: "היום" },
  { to: "/web/week", label: "שבוע" },
  { to: "/web/family", label: "משפחה" },
  { to: "/web/connections", label: "חיבורים" },
  { to: "/web/settings", label: "הגדרות" },
] as const;

/**
 * The web sidebar navigation — a vertical column of typed router Links (the desktop counterpart to the
 * phone's bottom tab bar). The active tab is ocean-tinted + bg-secondary via activeProps. Lives inside
 * WebShell's left (RTL: right) sidebar.
 */
export function SidebarNav() {
  return (
    <nav aria-label="ניווט ראשי" className="flex flex-col gap-1 px-3 py-2">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="rounded-[var(--radius)] px-3 py-2 text-[15px] transition-colors hover:bg-secondary"
          activeProps={{
            className: "bg-secondary font-semibold text-primary",
            "aria-current": "page",
          }}
          inactiveProps={{ className: "text-foreground" }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
