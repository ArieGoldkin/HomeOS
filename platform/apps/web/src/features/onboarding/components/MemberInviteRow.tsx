import { PersonAvatar } from "@shared/board";

export interface MemberInviteRowProps {
  name: string;
  role: string;
}

/** One row in the invite-the-family step: avatar + name/role + an invite affordance (inert for now). */
export function MemberInviteRow({ name, role }: MemberInviteRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-3 text-start">
      <PersonAvatar name={name} size={28} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[15px] text-foreground">{name}</p>
        <p className="text-[12px] text-muted-foreground">{role}</p>
      </div>
      <button
        type="button"
        className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-[13px] text-primary"
      >
        הזמנה
      </button>
    </div>
  );
}
