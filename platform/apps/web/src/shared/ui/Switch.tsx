import { cn } from "@shared/lib";
import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
  /** On/off state. */
  checked: boolean;
  /** Called with the next state when toggled. */
  onCheckedChange: (checked: boolean) => void;
}

/**
 * An RTL-aware toggle switch (#174) for Settings notifications. `role="switch"` + `aria-checked`
 * for assistive tech. The knob position is driven by flexbox justification (`justify-end` when on),
 * which is writing-mode aware — so the knob lands on the correct side under both `dir="ltr"` and
 * `dir="rtl"` without any manual translate-sign logic.
 */
export function Switch({ checked, onCheckedChange, className, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-[25px] w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50",
        checked ? "justify-end bg-primary" : "justify-start bg-muted",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="size-[19px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)]"
      />
    </button>
  );
}
