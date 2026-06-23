import { AddEventModal } from "@features/add-event";
import { EventDetailDrawer, useEventDetail } from "@features/event-detail";
import { useWeekDays } from "@shared/hooks";
import { addDaysIso, startOfWeekSundayIso } from "@shared/lib";
import { Button, Skeleton } from "@shared/ui";
import { useState } from "react";
import { WeekGrid } from "./components/WeekGrid";
import { WeekList } from "./components/WeekList";

const SKELETON = ["c0", "c1", "c2", "c3", "c4", "c5", "c6"];

export interface CalendarScreenProps {
  /** The anchor date `YYYY-MM-DD` (the week containing it, Sunday-start). */
  dateIso: string;
  /** A day was chosen → open it in Today. */
  onSelectDate: (dateIso: string) => void;
  /** Move to another week → re-anchor the Calendar route to this Sunday. */
  onChangeWeek: (anchorIso: string) => void;
}

/**
 * The Calendar screen (#180) — ONE responsive week view: a 7-column day-card grid at ≥md, a vertical
 * day list below md (both from the shared useWeekDays, so there's one source of truth). The Modern
 * header adds a mono range kicker + "Month YYYY" title (accent year) + prev/next + New event. Hosts the
 * detail drawer; New event opens the add modal.
 */
export function CalendarScreen({ dateIso, onSelectDate, onChangeWeek }: CalendarScreenProps) {
  const { status, days, rangeLabel } = useWeekDays(dateIso);
  const { selected, openDetail, closeDetail } = useEventDetail();
  const [addOpen, setAddOpen] = useState(false);

  const sunday = startOfWeekSundayIso(dateIso);
  const anchorDate = new Date(`${dateIso}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    month: "long",
  }).format(anchorDate);
  const year = dateIso.slice(0, 4);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
            {rangeLabel}
          </div>
          <h1 className="mt-2 font-display font-extrabold text-[34px] text-[color:var(--ink)] leading-[1.04] tracking-tight">
            {month} <span className="font-accent font-medium text-primary">{year}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="שבוע קודם"
            onClick={() => onChangeWeek(addDaysIso(sunday, -7))}
            className="grid size-9 place-items-center rounded-[10px] border border-[var(--chip-border)] bg-[var(--chip-bg)] text-[color:var(--ink-2)] transition-colors hover:bg-secondary"
          >
            ›
          </button>
          <button
            type="button"
            aria-label="שבוע הבא"
            onClick={() => onChangeWeek(addDaysIso(sunday, 7))}
            className="grid size-9 place-items-center rounded-[10px] border border-[var(--chip-border)] bg-[var(--chip-bg)] text-[color:var(--ink-2)] transition-colors hover:bg-secondary"
          >
            ‹
          </button>
          <Button
            variant="ink"
            className="min-h-0 rounded-[10px] px-4 py-2 text-[13px]"
            onClick={() => setAddOpen(true)}
          >
            + אירוע חדש
          </Button>
        </div>
      </header>

      {status === "loading" && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
          {SKELETON.map((k) => (
            <div
              key={k}
              className="min-h-[8rem] rounded-[var(--radius-card)] border border-[var(--card-border)] bg-card p-2"
            >
              <Skeleton variant="line" className="w-10" />
            </div>
          ))}
        </div>
      )}

      {status === "error" && (
        <p className="text-muted-foreground text-sm">שגיאה בטעינת השבוע — ננסה שוב בקרוב.</p>
      )}

      {status === "ready" && (
        <>
          <div className="hidden md:block">
            <WeekGrid days={days} onSelectDate={onSelectDate} onOpenDetail={openDetail} />
          </div>
          <div className="md:hidden">
            <WeekList days={days} onSelectDate={onSelectDate} />
          </div>
        </>
      )}

      <AddEventModal open={addOpen} onOpenChange={setAddOpen} />
      <EventDetailDrawer event={selected} onClose={closeDetail} surface="web" />
    </div>
  );
}
