import { cn } from "@shared/lib";
import { AddMemberButton } from "./AddMemberButton";
import { MemberListItem } from "./MemberListItem";

export interface FamilyMember {
  name: string;
  online?: boolean;
}

export interface FamilyGridProps {
  /** Ordered list of family members to display. */
  members: FamilyMember[];
  /** Column layout. 1 = single column (default); 2 = two columns at sm+. */
  columns?: 1 | 2;
  /** Forwarded to AddMemberButton. Inert if omitted. */
  onAddMember?: () => void;
  className?: string;
}

/**
 * Grid of MemberListItems followed by an AddMemberButton. Pure — accepts fully-resolved member
 * data. Use `columns=2` for wider phone breakpoints when there is enough horizontal room.
 */
export function FamilyGrid({ members, columns = 1, onAddMember, className }: FamilyGridProps) {
  return (
    <div
      className={cn(
        "grid gap-1",
        columns === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
        className,
      )}
    >
      {members.map((member) => (
        <MemberListItem key={member.name} name={member.name} online={member.online} />
      ))}
      <div className={cn("mt-2", columns === 2 && "sm:col-span-2")}>
        <AddMemberButton onClick={onAddMember} />
      </div>
    </div>
  );
}
