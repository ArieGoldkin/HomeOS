import { AddEventDialog } from "@features/add-event";
import { EventDetailDrawer, useEventDetail } from "@features/event-detail";
import { PersonAvatar } from "@shared/board";
import { useDayEvents, useNow } from "@shared/hooks";
import { greetingHe, hebDateLong } from "@shared/lib";
import { Button, Card } from "@shared/ui";
import { useState } from "react";
import { DayView } from "./DayView";

export interface TodayScreenProps {
  /** The selected day (`YYYY-MM-DD`) from the route's `?date=` search param (already coerced). */
  dateIso: string;
}

// Placeholder current user + household until a real identity model exists (deferred). The roster is the
// known family (mirrors FamilyView's KNOWN_ROSTER); presence/roles aren't server-backed yet.
const CURRENT_USER = "אמא";
const HOUSEHOLD = ["אבא", "אמא", "יואב", "נועה"] as const;

/**
 * The Today screen (#179) — the Modern greeting header + action chips over a card grid. The schedule
 * card hosts the data-connected DayView (timed spine + anytime tasks + tomorrow peek); a household card
 * gives the at-a-glance roster. Celebrations + the Tonight-dinner banner are DEFERRED — the grid leaves
 * room for them. The detail drawer (source_text) is safe on the single authenticated app.
 */
export function TodayScreen({ dateIso }: TodayScreenProps) {
  const now = useNow();
  const { status, timed, untimed, tomorrow, nowTime, moreCount } = useDayEvents(dateIso, now);
  const { selected, openDetail, closeDetail } = useEventDetail();
  const [addOpen, setAddOpen] = useState(false);
  const tasksLeft = untimed.length;

  return (
    <div className="flex flex-col gap-7">
      <header>
        <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {hebDateLong(now)}
        </div>
        <h1 className="mt-2 font-display font-extrabold text-[34px] text-[color:var(--ink)] leading-[1.05] tracking-tight">
          {greetingHe(now)},{" "}
          <span className="font-accent font-medium text-primary">{CURRENT_USER}</span>
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] px-4 py-2 font-semibold text-[13px] text-[color:var(--ink-2)] shadow-card">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            {tasksLeft} משימות היום
          </span>
          <Button
            variant="ink"
            className="min-h-0 rounded-full px-4 py-2 text-[13px]"
            onClick={() => setAddOpen(true)}
          >
            + משימה חדשה
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-[18px] lg:col-span-2">
          <DayView
            status={status}
            timed={timed}
            untimed={untimed}
            tomorrow={tomorrow}
            nowTime={nowTime}
            moreCount={moreCount}
            onOpenDetail={openDetail}
          />
        </Card>

        <Card className="p-[18px]">
          <div className="mb-3.5 flex items-center justify-between">
            <span className="font-semibold text-[14.5px] text-[color:var(--ink)]">משק הבית</span>
            <span className="font-accent text-[14px] text-muted-foreground">
              {HOUSEHOLD.length} בני בית
            </span>
          </div>
          <ul className="flex flex-col gap-3">
            {HOUSEHOLD.map((name) => (
              <li key={name} className="flex items-center gap-3">
                <PersonAvatar name={name} size={32} />
                <span className="font-semibold text-[13.5px] text-[color:var(--ink-2)]">
                  {name}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <AddEventDialog open={addOpen} onOpenChange={setAddOpen} />
      <EventDetailDrawer event={selected} onClose={closeDetail} />
    </div>
  );
}
