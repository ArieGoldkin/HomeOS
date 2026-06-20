import { cn } from "@shared/lib";
import type { InputHTMLAttributes } from "react";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label rendered above the input. */
  label: string;
  /** Must match the input's `id` to wire the `<label htmlFor>` association. */
  id: string;
  /** Validation error message. When set: input gets aria-invalid + an alert paragraph. */
  error?: string;
  /**
   * Numeric/temporal input (date, time, number). Forces `dir="ltr"` + `tabular-nums`
   * so Hebrew RTL layout does NOT reverse digit order (e.g. "14:30" stays "14:30").
   */
  numeric?: boolean;
}

/**
 * Labelled text/numeric input for the HomeOS form surfaces. Pairs a
 * `<label>` with an `<input>` via `id`/`htmlFor` for correct a11y association.
 * Error state is surfaced via `aria-invalid` + a live `role="alert"` paragraph.
 */
export function Field({ label, id, error, numeric, className, ...inputProps }: FieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        dir={numeric ? "ltr" : undefined}
        className={cn(
          "border border-input rounded-[var(--radius)] px-3 min-h-11 bg-background w-full",
          numeric && "tabular-nums",
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error && (
        <p id={errorId} role="alert" className="text-[12px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
