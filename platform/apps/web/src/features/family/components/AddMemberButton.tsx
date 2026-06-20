import { cn } from "@shared/lib";

export interface AddMemberButtonProps {
  /** Called when the button is activated. Inert (no-op) if omitted. */
  onClick?: () => void;
  className?: string;
}

/**
 * Full-width dashed placeholder button for adding a new family member.
 * Inert when `onClick` is not provided — the actual add-member flow is future work.
 */
export function AddMemberButton({ onClick, className }: AddMemberButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center justify-center gap-2",
        "rounded-[var(--radius)] border border-dashed border-input",
        "text-[14px] text-muted-foreground",
        "hover:bg-secondary transition-colors",
        className,
      )}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        +
      </span>
      <span>הוספת בן משפחה</span>
    </button>
  );
}
