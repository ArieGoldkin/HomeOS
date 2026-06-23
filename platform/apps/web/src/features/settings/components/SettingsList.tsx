import { Card } from "@shared/ui";
import type { ReactNode } from "react";

export interface SettingsListProps {
  /** Optional section heading rendered above the card container. */
  title?: string;
  /** `SettingsRow` children stacked inside a divided card. */
  children: ReactNode;
}

/**
 * A labeled group of `SettingsRow`s inside the shared `Card` (#183 re-skin) with editorial hairline
 * dividers (`--line`) between rows. The title uses the Modern section-label idiom (matching Today /
 * People / Connections) rather than the old muted eyebrow.
 */
export function SettingsList({ title, children }: SettingsListProps) {
  return (
    <section className="flex flex-col gap-2.5">
      {title && (
        <span className="px-1 font-semibold text-[14.5px] text-[color:var(--ink)]">{title}</span>
      )}
      <Card className="divide-y divide-[var(--line)] overflow-hidden">{children}</Card>
    </section>
  );
}
