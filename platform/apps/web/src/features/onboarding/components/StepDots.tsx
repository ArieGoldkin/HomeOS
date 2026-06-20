import { cn } from "@shared/lib";

export interface StepDotsProps {
  total: number;
  active: number;
}

/** A row of progress dots (decorative — the active step is also announced via the step heading). */
export function StepDots({ total, active }: StepDotsProps) {
  const dots = Array.from({ length: total }, (_, i) => ({ id: i }));
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-1.5">
      {dots.map((dot) => (
        <span
          key={dot.id}
          className={cn(
            "h-1.5 rounded-full transition-all",
            dot.id === active ? "w-5 bg-primary" : "w-1.5 bg-border",
          )}
        />
      ))}
    </div>
  );
}
