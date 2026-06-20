import { AddEventSheet } from "@features/add-event";
import { IconButton } from "@shared/ui";
import { Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { PhoneBottomNav } from "./PhoneBottomNav";
import { PhoneStatusBar } from "./PhoneStatusBar";

/**
 * The phone surface chrome (layout route for `/phone/*`): a minimal status bar + wordmark masthead
 * with the add FAB, a scrollable screen area (<Outlet/> renders the active tab), and the fixed bottom
 * tab bar. Day theme (no data-theme="night" — that's the tablet). The FAB opens the AddEvent sheet.
 */
export function PhoneShell() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="paper-grain relative mx-auto flex min-h-dvh max-w-md flex-col bg-background text-foreground">
      <PhoneStatusBar />
      <header className="flex items-center justify-between px-5 pt-3 pb-2">
        <h1 className="font-display font-bold text-[20px]">הבית</h1>
        <IconButton aria-label="הוספה ללוח" variant="primary" onClick={() => setAddOpen(true)}>
          <span aria-hidden="true" className="text-2xl leading-none">
            +
          </span>
        </IconButton>
      </header>
      <main className="flex-1 overflow-y-auto px-5 pb-24">
        <Outlet />
      </main>
      <PhoneBottomNav />
      <AddEventSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
