import { PersonAvatar } from "@shared/board";
import { Button, Card } from "@shared/ui";

// Placeholder identity until a real per-user model exists (deferred) — mirrors the CURRENT_USER /
// roster placeholders elsewhere. The email renders LTR inside the RTL layout.
const PROFILE = { name: "אמא", email: "ima@mishpachat-homeos.co.il" } as const;

/**
 * The Settings profile card (#183) — avatar + name + email + an Edit affordance. Presentational only:
 * there's no identity/account backend yet, so "עריכה" is inert.
 */
export function ProfileCard() {
  return (
    <Card className="flex items-center gap-4 p-[18px]" data-testid="profile-card">
      <PersonAvatar name={PROFILE.name} size={52} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[16px] text-[color:var(--ink)]">{PROFILE.name}</p>
        <p dir="ltr" className="truncate text-start text-[13px] text-ink-soft">
          {PROFILE.email}
        </p>
      </div>
      <Button variant="ink" className="min-h-0 rounded-full px-4 py-2 text-[13px]">
        עריכה
      </Button>
    </Card>
  );
}
