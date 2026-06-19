import { SectionHeader } from "@shared/board";
import type { ReactNode } from "react";

export interface SettingsListProps {
  /** Optional section heading rendered above the card container. */
  title?: string;
  /** `SettingsRow` children stacked inside a divided card. */
  children: ReactNode;
}

/**
 * A labeled group of `SettingsRow`s inside a `bg-card` rounded container with
 * hairline dividers between rows. Title is rendered via `SectionHeader` (muted eyebrow).
 */
export function SettingsList({ title, children }: SettingsListProps) {
  return (
    <section className="flex flex-col gap-2">
      {title && <SectionHeader className="px-1">{title}</SectionHeader>}
      <div className="bg-card rounded-[var(--radius)] divide-y divide-border overflow-hidden">
        {children}
      </div>
    </section>
  );
}
