"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { getISOWeek, getISOWeekYear } from "date-fns";

import { api, ApiError, fetchEvents } from "@/lib/api";

import type { Dispatch, SetStateAction } from "react";
import type { IEvent, IUser } from "@/calendar/interfaces";
import type { TBadgeVariant, TVisibleHours, TWorkingHours } from "@/calendar/types";

interface ICalendarContext {
  selectedDate: Date;
  setSelectedDate: (date: Date | undefined) => void;
  selectedUserId: IUser["id"] | "all";
  setSelectedUserId: (userId: IUser["id"] | "all") => void;
  badgeVariant: TBadgeVariant;
  setBadgeVariant: (variant: TBadgeVariant) => void;
  users: IUser[];
  workingHours: TWorkingHours;
  setWorkingHours: Dispatch<SetStateAction<TWorkingHours>>;
  visibleHours: TVisibleHours;
  setVisibleHours: Dispatch<SetStateAction<TVisibleHours>>;
  events: IEvent[];
  setLocalEvents: Dispatch<SetStateAction<IEvent[]>>;
  /** Re-reads events from the Worker; call after any mutation. */
  refreshEvents: () => Promise<void>;
  isLoading: boolean;
  loadError: string;

  /** ISO week to outline in the month grid, or null for none. */
  highlightedWeek: { year: number; week: number } | null;
  setHighlightedWeek: (week: { year: number; week: number } | null) => void;

  /**
   * Deleting events is off until it is switched on from the search box. It is
   * a guard against a mis-tap on a phone, not a security boundary — the API
   * still accepts DELETE from anyone holding a session.
   */
  superuser: boolean;
  setSuperuser: (on: boolean) => void;
  /** Whether the masked passphrase prompt is open. */
  askForSuperuser: boolean;
  setAskForSuperuser: (open: boolean) => void;

  /** Set to open that event straight in the editor, from anywhere. */
  eventToOpen: IEvent | null;
  setEventToOpen: (event: IEvent | null) => void;
  /** Set to list a single day's events, which is how a phone drills in. */
  dayToOpen: Date | null;
  setDayToOpen: (date: Date | null) => void;
  /** Set to open a blank editor pre-dated to that day. */
  newEventDate: Date | null;
  setNewEventDate: (date: Date | null) => void;
}

const CalendarContext = createContext({} as ICalendarContext);

const WORKING_HOURS = {
  0: { from: 0, to: 0 },
  1: { from: 8, to: 17 },
  2: { from: 8, to: 17 },
  3: { from: 8, to: 17 },
  4: { from: 8, to: 17 },
  5: { from: 8, to: 17 },
  6: { from: 8, to: 12 },
};

const VISIBLE_HOURS = { from: 7, to: 18 };

const USERS: IUser[] = [{ id: "me", name: "Me", picturePath: null }];

/**
 * Events are fetched a year either side of whatever year is on screen, so
 * ordinary month-to-month paging never waits on the network. Crossing into a
 * new window triggers one refetch.
 */
function windowForYear(year: number) {
  return { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` };
}

export function CalendarProvider({ children, onSessionExpired }: { children: React.ReactNode; onSessionExpired?: () => void }) {
  const [badgeVariant, setBadgeVariant] = useState<TBadgeVariant>("colored");
  const [visibleHours, setVisibleHours] = useState<TVisibleHours>(VISIBLE_HOURS);
  const [workingHours, setWorkingHours] = useState<TWorkingHours>(WORKING_HOURS);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedUserId, setSelectedUserId] = useState<IUser["id"] | "all">("all");

  const [localEvents, setLocalEvents] = useState<IEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [highlightedWeek, setHighlightedWeek] = useState<{ year: number; week: number } | null>(null);
  const [superuser, setSuperuser] = useState(false);
  const [askForSuperuser, setAskForSuperuser] = useState(false);
  const [eventToOpen, setEventToOpen] = useState<IEvent | null>(null);
  const [dayToOpen, setDayToOpen] = useState<Date | null>(null);
  const [newEventDate, setNewEventDate] = useState<Date | null>(null);

  const loadedYear = useRef<number | null>(null);

  const load = useCallback(
    async (year: number) => {
      const { from, to } = windowForYear(year);
      setIsLoading(true);
      setLoadError("");
      try {
        setLocalEvents(await fetchEvents(from, to));
        loadedYear.current = year;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          onSessionExpired?.();
          return;
        }
        setLoadError(err instanceof Error ? err.message : "Could not load events.");
      } finally {
        setIsLoading(false);
      }
    },
    [onSessionExpired]
  );

  const refreshEvents = useCallback(async () => {
    await load(loadedYear.current ?? selectedDate.getFullYear());
  }, [load, selectedDate]);

  // The capability lives in an HttpOnly cookie, so only the Worker can say
  // whether it is still valid — ask once on load rather than assuming it is off.
  useEffect(() => {
    let cancelled = false;
    api<{ enabled: boolean }>("/api/superuser")
      .then(({ enabled }) => !cancelled && setSuperuser(enabled))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const year = selectedDate.getFullYear();
    if (loadedYear.current === year) return;
    void load(year);
  }, [selectedDate, load]);

  const handleSelectDate = (date: Date | undefined) => {
    if (!date) return;

    // A highlighted week only means anything while it is on screen. Navigating
    // elsewhere — the year or month boxes, Today, the arrows, a search result —
    // used to leave the outline invisible but its Clear button still showing.
    // Handled here so every route through the calendar behaves the same.
    if (highlightedWeek && (getISOWeek(date) !== highlightedWeek.week || getISOWeekYear(date) !== highlightedWeek.year)) {
      setHighlightedWeek(null);
    }

    setSelectedDate(date);
  };

  return (
    <CalendarContext.Provider
      value={{
        selectedDate,
        setSelectedDate: handleSelectDate,
        selectedUserId,
        setSelectedUserId,
        badgeVariant,
        setBadgeVariant,
        users: USERS,
        visibleHours,
        setVisibleHours,
        workingHours,
        setWorkingHours,
        events: localEvents,
        setLocalEvents,
        refreshEvents,
        isLoading,
        loadError,
        highlightedWeek,
        setHighlightedWeek,
        superuser,
        setSuperuser,
        askForSuperuser,
        setAskForSuperuser,
        eventToOpen,
        setEventToOpen,
        dayToOpen,
        setDayToOpen,
        newEventDate,
        setNewEventDate,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar(): ICalendarContext {
  const context = useContext(CalendarContext);
  if (!context) throw new Error("useCalendar must be used within a CalendarProvider.");
  return context;
}
