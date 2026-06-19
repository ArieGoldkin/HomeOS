// Family feature barrel — only FamilyView is part of the public surface.
// Internal atoms (StatusDot, MemberListItem, AddMemberButton, FamilyGrid) remain
// feature-private; promote to @shared/board only if another feature needs them.
export { FamilyView, type FamilyViewProps } from "./FamilyView";
