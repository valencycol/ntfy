import { format, getISOWeek, getISOWeekYear } from "date-fns";
import { useEffect, useMemo, useRef } from "react";
import { isToday, startOfDay } from "date-fns";

import { useCalendar } from "@/calendar/contexts/calendar-context";

import { EventBullet } from "@/calendar/components/month-view/event-bullet";
import { DroppableDayCell } from "@/calendar/components/dnd/droppable-day-cell";
import { MonthEventBadge } from "@/calendar/components/month-view/month-event-badge";

import { cn } from "@/lib/utils";
import { getMonthCellEvents } from "@/calendar/helpers";

import type { ICalendarCell, IEvent } from "@/calendar/interfaces";

interface IProps {
  cell: ICalendarCell;
  events: IEvent[];
  eventPositions: Record<string, number>;
}

/** How long a single click waits to see whether it is really a double. */
const DOUBLE_CLICK_GRACE_MS = 220;

const MAX_VISIBLE_EVENTS = 3;

export function DayCell({ cell, events, eventPositions }: IProps) {
  const { setSelectedDate, highlightedWeek, setDayToOpen, setNewEventDate } = useCalendar();

  const { day, currentMonth, date } = cell;

  const inHighlightedWeek =
    !!highlightedWeek && getISOWeek(date) === highlightedWeek.week && getISOWeekYear(date) === highlightedWeek.year;

  const cellEvents = useMemo(() => getMonthCellEvents(date, events, eventPositions), [date, events, eventPositions]);
  const isSunday = date.getDay() === 0;

  /**
   * A tile opens what the day actually holds: its events if there are any,
   * otherwise a blank editor for that date. Navigating away to the day view
   * was too abrupt a jump for a single tap.
   */
  const openTile = () => {
    setSelectedDate(date);
    if (cellEvents.length > 0) setDayToOpen(date);
    else setNewEventDate(date);
  };

  // A double click also fires two single clicks, so opening the list is held
  // back briefly to see whether a second click is coming.
  const singleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (singleClickTimer.current) clearTimeout(singleClickTimer.current); }, []);

  const cancelPendingOpen = () => {
    if (!singleClickTimer.current) return;
    clearTimeout(singleClickTimer.current);
    singleClickTimer.current = null;
  };

  /**
   * Closing a dialog lets the same click land on the tile underneath, which
   * would otherwise pop the day list open on top of whatever was just opened.
   */
  const dialogIsOpen = () => !!document.querySelector('[role="dialog"]');

  const openTileAfterPause = () => {
    cancelPendingOpen();
    if (dialogIsOpen()) return;
    singleClickTimer.current = setTimeout(() => {
      if (!dialogIsOpen()) openTile();
    }, DOUBLE_CLICK_GRACE_MS);
  };

  const openBlankEditor = () => {
    cancelPendingOpen();
    // Deliberately not guarded on dialogIsOpen(): if the single-click timer
    // won the race the day list is already up, and a double click must take
    // over from it rather than give up. Closing it here makes the gesture
    // behave the same whichever way that race lands.
    setDayToOpen(null);
    setSelectedDate(date);
    setNewEventDate(date);
  };

  /** The day number navigates, and a badge opens its own event. */
  const isOwnControl = (target: EventTarget | null) =>
    !!(target as HTMLElement | null)?.closest("[data-event-badge],[data-day-number]");

  return (
    <DroppableDayCell cell={cell}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        onClick={e => {
          if (isOwnControl(e.target)) return;
          openTileAfterPause();
        }}
        onDoubleClick={e => {
          if (isOwnControl(e.target)) return;
          openBlankEditor();
        }}
        data-week-highlight={inHighlightedWeek ? "" : undefined}
        className={cn(
          "flex h-full flex-col gap-1 border-l border-t py-1.5 lg:pb-2 lg:pt-1",
          isSunday && "border-l-0",
          // Jumping to a week number outlines the whole week so it is obvious
          // which one was landed on, especially on a phone.
          inHighlightedWeek && "bg-primary/5 ring-1 ring-inset ring-primary/40"
        )}
      >
        <div className="flex items-start justify-between pr-1.5">
          <button
            onClick={openTileAfterPause}
            data-day-number=""
            className={cn(
              "flex size-6 translate-x-1 items-center justify-center rounded-full text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring lg:px-2",
              !currentMonth && "opacity-20",
              isToday(date) && "bg-primary font-bold text-primary-foreground hover:bg-primary"
            )}
          >
            {day}
          </button>

          {cellEvents.length > 0 && (
            <button
              type="button"
              onClick={openTileAfterPause}
              aria-label={`${cellEvents.length} event${cellEvents.length === 1 ? "" : "s"} on ${format(date, "d MMMM yyyy")} — open the list`}
              className={cn(
                "min-w-4 rounded-full bg-muted px-1 text-[0.625rem] font-semibold leading-4 text-muted-foreground",
                "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                !currentMonth && "opacity-40"
              )}
            >
              {cellEvents.length}
            </button>
          )}
        </div>

        <div
          className={cn("flex h-6 gap-1 px-2 lg:h-[94px] lg:flex-col lg:gap-2 lg:px-0", !currentMonth && "opacity-50")}
        >
          {[0, 1, 2].map(position => {
            const event = cellEvents.find(e => e.position === position);
            const eventKey = event ? `event-${event.id}-${position}` : `empty-${position}`;

            return (
              <div key={eventKey} className="lg:flex-1">
                {event && (
                  <>
                    <EventBullet className="lg:hidden" color={event.color} title={event.title} />
                    <MonthEventBadge className="hidden lg:flex" event={event} cellDate={startOfDay(date)} />
                  </>
                )}
              </div>
            );
          })}
        </div>

        {cellEvents.length > MAX_VISIBLE_EVENTS && (
          <button
            type="button"
            onClick={openTileAfterPause}
            aria-label={`Show all ${cellEvents.length} events on ${format(date, "d MMMM yyyy")}`}
            className={cn(
              "h-4.5 px-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              !currentMonth && "opacity-50"
            )}
          >
            <span className="sm:hidden">+{cellEvents.length - MAX_VISIBLE_EVENTS}</span>
            <span className="hidden sm:inline"> {cellEvents.length - MAX_VISIBLE_EVENTS} more...</span>
          </button>
        )}
      </div>
    </DroppableDayCell>
  );
}
