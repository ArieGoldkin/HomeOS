import { AddEventDialog } from "@features/add-event";
import { EventDetailDrawer, useEventDetail } from "@features/event-detail";
import type { SavedEvent } from "@homeos/shared";
import { useCurrentUser } from "@shared/auth";
import { PersonAvatar } from "@shared/board";
import { useDayEvents, useFamily, useNow, useToggleEventStatus, useWeekDays } from "@shared/hooks";
import { greetingHe, hebDateLong, hebrewDateLabel, holidaysOn } from "@shared/lib";
import { Button, Card, SectionLabel, Skeleton } from "@shared/ui";
import { useState } from "react";
import { DayView } from "./DayView";
import { WeekStrip } from "./WeekStrip";

export interface TodayScreenProps {
  /** The selected day (`YYYY-MM-DD`) from the route's `?date=` search param (already coerced). */
  dateIso: string;
  /** #283 — called with a week-strip day's `dateIso`; the route wrapper navigates `?date=`. */
  onSelectDate?: (dateIso: string) => void;
}

/**
 * The Today screen (#179) — the Modern greeting header + action chips over a card grid. The schedule
 * card hosts the data-connected DayView (timed spine + anytime tasks + tomorrow peek); a household card
 * gives the at-a-glance roster. Celebrations + the Tonight-dinner banner are DEFERRED — the grid leaves
 * room for them. The detail drawer (source_text) is safe on the single authenticated app.
 */
// #235 — skeleton-row keys for the household card while the roster loads (avoids flashing "0 בני בית").
const HOUSEHOLD_SKELETON = ["hh1", "hh2", "hh3"];

export function TodayScreen({ dateIso, onSelectDate }: TodayScreenProps) {
  const now = useNow();
  // #283 — the week strip rides the same GET /events cache as the day view (no extra fetch).
  const { days } = useWeekDays(dateIso);
  const { full_name, email } = useCurrentUser();
  // #235 — the household roster from the real GET /family route (was the hardcoded HOUSEHOLD mock).
  const { data: family, status: familyStatus } = useFamily();
  const household = family?.members.map((m) => m.name) ?? [];
  // #230 — first name from the Google session; no hardcoded fallback (empty greeting beats a fake name).
  const me = full_name?.split(" ")[0] ?? email?.split("@")[0] ?? "";
  const { status, timed, untimed, tomorrow, nowTime, moreCount, standing } = useDayEvents(
    dateIso,
    now,
  );
  const { selected, openDetail, closeDetail } = useEventDetail();
  const toggleStatus = useToggleEventStatus();
  const [addOpen, setAddOpen] = useState(false);
  // #19 — "X משימות היום" counts OPEN items only; a completed task drops out of the count.
  const tasksLeft = untimed.filter((e) => e.status !== "done").length;

  // #19 — flip a board task's open↔done. Derives the next status from the row's current one.
  const handleToggleDone = (event: SavedEvent) => {
    toggleStatus.mutate({ id: event.id, status: event.status === "done" ? "open" : "done" });
  };

  // #25 — Hebrew calendar date + any Israeli holiday for the displayed day.
  const hebrewDate = hebrewDateLabel(dateIso);
  const holidays = holidaysOn(dateIso);

  return (
    <div className="flex flex-col gap-7">
      <header>
        <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {hebDateLong(now)}
          {hebrewDate && ` · ${hebrewDate}`}
        </div>
        <h1 className="mt-2 font-display font-extrabold text-[34px] text-[color:var(--ink)] leading-[1.05] tracking-tight">
          {greetingHe(now)}, <span className="font-accent font-medium text-primary">{me}</span>
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] px-4 py-2 font-semibold text-[13px] text-[color:var(--ink-2)] shadow-card">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            {tasksLeft} משימות היום
          </span>
          {holidays.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 font-semibold text-[13px] text-primary"
            >
              <span aria-hidden="true">✦</span>
              {name}
            </span>
          ))}
          <Button
            variant="ink"
            className="min-h-0 rounded-full px-4 py-2 text-[13px]"
            onClick={() => setAddOpen(true)}
          >
            + משימה חדשה
          </Button>
        </div>
      </header>

      <WeekStrip days={days} onSelectDay={onSelectDate} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-[18px] lg:col-span-2">
          <DayView
            status={status}
            timed={timed}
            untimed={untimed}
            tomorrow={tomorrow}
            nowTime={nowTime}
            moreCount={moreCount}
            standing={standing}
            onOpenDetail={openDetail}
            onToggleDone={handleToggleDone}
          />
        </Card>

        <Card className="p-[18px]">
          <div className="mb-3.5 flex items-center justify-between">
            <SectionLabel>משק הבית</SectionLabel>
            {familyStatus !== "pending" && (
              <span className="font-accent text-[14px] text-muted-foreground">
                {household.length} בני בית
              </span>
            )}
          </div>
          {familyStatus === "pending" ? (
            <ul className="flex flex-col gap-3">
              {HOUSEHOLD_SKELETON.map((k) => (
                <li key={k}>
                  <Skeleton variant="line" className="w-full" />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col gap-3">
              {household.map((name) => (
                <li key={name} className="flex items-center gap-3">
                  <PersonAvatar name={name} size={32} />
                  <span className="font-semibold text-[13.5px] text-[color:var(--ink-2)]">
                    {name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <AddEventDialog open={addOpen} onOpenChange={setAddOpen} />
      <EventDetailDrawer event={selected} onClose={closeDetail} />
    </div>
  );
}
