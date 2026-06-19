import { cn, jerusalemHhmm, jerusalemHour } from "@shared/lib";
import type { ReactNode } from "react";

const TZ = "Asia/Jerusalem";

function greetingHe(hour: number): string {
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  if (hour >= 17 && hour < 21) return "ערב טוב";
  return "לילה טוב";
}

/** Localized Gregorian date in Jerusalem (the Jewish-calendar date is a later hebcal task, #25). */
function hebDate(now: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

export interface TabletShellProps {
  /** Current time (from useNow at the surface) — drives the masthead clock + greeting. */
  now: Date;
  /** Optional ambient footer copy — injected, never fabricated (real weather API + hebcal land later). */
  weather?: string;
  shabbat?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The kitchen-tablet chrome: a greeting + big LTR clock masthead, the board, and an optional
 * weather/Shabbat footer — over a paper-grain wash. Always runs the night theme (the tablet is
 * always-on). Pure: it takes `now` as a prop so it's deterministic in tests. No AddSheet — the tablet
 * is glance-only.
 */
export function TabletShell({ now, weather, shabbat, children, className }: TabletShellProps) {
  const showFooter = Boolean(weather || shabbat);

  return (
    <div
      data-theme="night"
      className={cn(
        "paper-grain relative flex min-h-dvh flex-col bg-background text-foreground",
        className,
      )}
    >
      <header className="flex items-end justify-between gap-3 px-8 pt-6 pb-4">
        <h1 className="font-display font-bold text-[22px]">{greetingHe(jerusalemHour(now))}</h1>
        <div className="text-end leading-none">
          <span dir="ltr" className="block font-display font-bold text-[40px] tabular-nums">
            {jerusalemHhmm(now)}
          </span>
          <span className="mt-1 block font-semibold text-[12px] text-muted-foreground">
            {hebDate(now)}
          </span>
        </div>
      </header>

      <main className="flex-1 px-8 pb-8">{children}</main>

      {showFooter && (
        <footer className="flex items-center gap-3 border-border border-t bg-secondary px-8 py-3 text-[13px] text-muted-foreground">
          {weather && <span>{weather}</span>}
          {shabbat && <span className="ms-auto font-semibold text-primary">{shabbat}</span>}
        </footer>
      )}
    </div>
  );
}
