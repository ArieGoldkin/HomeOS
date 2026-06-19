import { assigneeColor, cn } from "@shared/lib";
import type { CSSProperties, HTMLAttributes } from "react";

export interface PersonAvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** The person — drives the fill via assigneeColor() (runtime, never a --who-* token). */
  name: string;
  /** Diameter in px (default 20). */
  size?: number;
  /** Pick the night-optimized color set (the always-on tablet runs night by default). */
  night?: boolean;
}

/**
 * A round initial-badge in the person's stable color — the assignee indicator on the tablet board
 * (EventCard meta, family rows). Always paired with a visible name in our layouts, so it's decorative
 * (`aria-hidden`) by default. White-on-color initial; the color comes from the free-form assignee
 * string at runtime, never a token.
 */
export function PersonAvatar({
  name,
  size = 20,
  night = false,
  className,
  style,
  ...props
}: PersonAvatarProps) {
  const color = assigneeColor(name);
  const initial = [...name.trim()][0] ?? "?";
  const dims: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.52),
    background: night ? color.night : color.light,
    ...style,
  };

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-bold text-white",
        className,
      )}
      style={dims}
      {...props}
    >
      {initial}
    </span>
  );
}
