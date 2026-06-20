import { AddEventModal } from "@features/add-event";
import { IconButton } from "@shared/ui";
import { Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { AvatarStack } from "./components/AvatarStack";
import { SidebarNav } from "./components/SidebarNav";

/** The known family roster shown in the sidebar footer (mirrors FamilyView's KNOWN_ROSTER). */
const ROSTER = ["אבא", "אמא", "יואב", "נועה"];

/**
 * The web surface chrome (layout route for `/web/*`): a 244px sidebar (wordmark + SidebarNav + family
 * AvatarStack footer) beside a scrollable main column whose top bar carries the Add button. Under the
 * app's `dir="rtl"` the sidebar sits on the RIGHT (first flex child) with its divider on the inline-end
 * (left) edge. Day theme (no `data-theme="night"` — that's the tablet). The Add button opens AddEventModal.
 */
export function WebShell() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="paper-grain flex min-h-dvh bg-background text-foreground">
      <aside className="flex w-[244px] shrink-0 flex-col border-border border-e bg-card">
        <div className="px-5 pt-5 pb-3">
          <h1 className="font-display font-bold text-[20px]">הבית</h1>
        </div>
        <SidebarNav />
        <div className="mt-auto border-border border-t p-4">
          <AvatarStack names={ROSTER} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-border border-b px-8 py-4">
          <span className="font-medium text-[15px] text-muted-foreground">לוח המשפחה</span>
          <IconButton aria-label="הוספה ללוח" variant="primary" onClick={() => setAddOpen(true)}>
            <span aria-hidden="true" className="text-2xl leading-none">
              +
            </span>
          </IconButton>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <Outlet />
        </main>
      </div>

      <AddEventModal open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
