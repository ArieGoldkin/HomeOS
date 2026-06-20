import { cn } from "@shared/lib";

export interface ConnectionCardProps {
  /** Service name, e.g. "Google Calendar". */
  name: string;
  /** One-line description of what connecting does. */
  description?: string;
  /** Whether the service is currently connected. */
  connected?: boolean;
  className?: string;
}

/**
 * A single connection row on the web Connections screen (e.g. Google Calendar). Presentational only —
 * the live connect flow is Milestone #10 (#111/#112), unbuilt, so the action is disabled ("בקרוב").
 * Uses `--wa-green` (the integration brand color) for the connected indicator, never `--primary` (ocean).
 */
export function ConnectionCard({
  name,
  description,
  connected = false,
  className,
}: ConnectionCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-4",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-wa-green/10 font-bold text-wa-green"
      >
        G
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[15px] text-foreground">{name}</p>
        {description && <p className="truncate text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {connected ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-[13px] text-wa-green">
          <span aria-hidden="true" className="size-2 rounded-full bg-wa-green" />
          מחובר
        </span>
      ) : (
        <button
          type="button"
          disabled
          className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-[13px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          בקרוב
        </button>
      )}
    </div>
  );
}
