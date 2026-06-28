import { assigneeColor, cn } from "@shared/lib";
import { useThemeMode } from "@shared/theme";
import { type CSSProperties, type HTMLAttributes, useState } from "react";

export interface PersonAvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** The person — drives the fill via assigneeColor() (runtime, never a --who-* token). */
  name: string;
  /** Diameter in px (default 20). */
  size?: number;
  /** #230 — optional photo (e.g. the Google `avatar_url`); when set, renders the image instead of the initial. */
  imageUrl?: string | null;
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
  imageUrl,
  className,
  style,
  ...props
}: PersonAvatarProps) {
  const color = assigneeColor(name);
  // #230 — Google avatar URLs can 403 (referrer) or 404; fall back to the initial on load error.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!imageUrl && !imgFailed;
  const mode = useThemeMode();
  const initial = [...name.trim()][0] ?? "?";
  const dims: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.52),
    // #230 — a photo fills the circle; otherwise the stable per-person color backs the initial.
    background: showImage ? undefined : mode === "dark" ? color.night : color.light,
    ...style,
  };

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white",
        className,
      )}
      style={dims}
      {...props}
    >
      {showImage ? (
        <img
          src={imageUrl ?? undefined}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
