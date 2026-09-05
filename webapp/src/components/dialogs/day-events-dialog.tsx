"use client";

import { useMemo } from "react";
import { endOfDay, format, isWithinInterval, parseISO, startOfDay } from "date-fns";
import { CalendarPlus, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { nameToHex } from "@/lib/api";
import { useCalendar } from "@/calendar/contexts/calendar-context";

/**
 * A day's events as a tappable list. This is how a phone drills into a month
 * tile, where there is no room for titled badges — picking one hands straight
 * over to the editor.
 */
export function DayEventsDialog() {
  const { dayToOpen, setDayToOpen, setEventToOpen, setNewEventDate, events } = useCalendar();

  const forDay = useMemo(() => {
    if (!dayToOpen) return [];
    const interval = { start: startOfDay(dayToOpen), end: endOfDay(dayToOpen) };

    return events
      .filter(event => {
        const start = parseISO(event.startDate);
        const end = parseISO(event.endDate);
        // A multi-day event belongs to every day it covers, not just its first.
        return isWithinInterval(start, interval) || isWithinInterval(end, interval) || (start < interval.start && end > interval.end);
      })
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startDate.localeCompare(b.startDate));
  }, [dayToOpen, events]);

  const when = (event: (typeof forDay)[number]) => {
    if (event.allDay) return "All day";
    return `${format(parseISO(event.startDate), "h:mm a")} – ${format(parseISO(event.endDate), "h:mm a")}`;
  };

  return (
    <Dialog open={!!dayToOpen} onOpenChange={open => !open && setDayToOpen(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dayToOpen ? format(dayToOpen, "EEEE, d MMMM yyyy") : ""}</DialogTitle>
          <DialogDescription>
            {forDay.length === 0
              ? "Nothing on this day yet."
              : `${forDay.length} event${forDay.length === 1 ? "" : "s"} — tap one to edit it.`}
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y">
          {forDay.map(event => (
            <li key={event.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setDayToOpen(null);
                  setEventToOpen(event);
                }}
              >
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: nameToHex(event.color) }} />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{event.title}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {when(event)}
                    {event.repeatYearly && " · yearly"}
                  </span>
                </span>

                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const date = dayToOpen;
            setDayToOpen(null);
            setNewEventDate(date);
          }}
        >
          <CalendarPlus className="size-4" />
          Add an event on this day
        </Button>
      </DialogContent>
    </Dialog>
  );
}
