/**
 * Lists is a DEFERRED net-new surface (grocery/errands cards + its own backend). The nav rail ships a
 * Lists item, so the route resolves to this minimal "coming soon" placeholder rather than a dead link.
 * The real screen is a follow-up.
 */
export function ListsPlaceholder() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-bold text-[28px] text-[color:var(--ink)] tracking-tight">רשימות</h1>
      <p className="mt-2 text-muted-foreground">
        רשימות משפחתיות — <span className="font-accent">בקרוב</span>
      </p>
    </div>
  );
}
