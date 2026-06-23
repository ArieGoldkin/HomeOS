import { cn } from "@shared/lib";
import type { ReactNode } from "react";

export interface SettingsRowProps {
  /** The row label (font-medium, start-side). */
  label: string;
  /** Secondary read-only value shown on the end-side (muted). Ignored when `control` is present. */
  value?: ReactNode;
  /** Interactive control (toggle, etc.) placed on the end-side. Takes precedence over `value`. */
  control?: ReactNode;
  /** When set, the row becomes a `<button>` and shows an RTL chevron affordance. */
  onClick?: () => void;
}

const ROW_BASE = "flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5";

/**
 * A single settings row. Renders as `<button>` (with RTL chevron) when `onClick` is provided,
 * otherwise a plain `<div>`. End-side shows `control` first, falling back to `value`.
 */
export function SettingsRow({ label, value, control, onClick }: SettingsRowProps) {
  const end =
    control ??
    (value !== undefined ? <span className="text-sm text-muted-foreground">{value}</span> : null);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(ROW_BASE, "cursor-pointer text-start hover:bg-accent transition-colors")}
      >
        <span className="text-sm font-medium text-[color:var(--ink)]">{label}</span>
        <span className="flex items-center gap-2">
          {end}
          {/* RTL chevron: "‹" points right in LTR but acts as a back-arrow in RTL,
              which is the "forward/navigate" affordance in an RTL settings list. */}
          <span aria-hidden="true" className="text-muted-foreground select-none">
            ‹
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className={cn(ROW_BASE)}>
      <span className="text-sm font-medium text-[color:var(--ink)]">{label}</span>
      {end && <span className="flex items-center">{end}</span>}
    </div>
  );
}
