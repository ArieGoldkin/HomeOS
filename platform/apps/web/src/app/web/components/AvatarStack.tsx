import { PersonAvatar } from "@shared/board";
import { cn } from "@shared/lib";

export interface AvatarStackProps {
  /** Family member names, in display order. */
  names: string[];
  className?: string;
}

/**
 * A compact row of family member color-dots for the WebShell sidebar footer. Presentational — names are
 * supplied by the shell. Each avatar carries the member name as a `title` for hover/affordance; the row
 * is labelled for assistive tech.
 */
export function AvatarStack({ names, className }: AvatarStackProps) {
  return (
    <ul aria-label="בני המשפחה" className={cn("flex items-center gap-2", className)}>
      {names.map((name) => (
        <li key={name} title={name}>
          <PersonAvatar name={name} size={28} />
        </li>
      ))}
    </ul>
  );
}
