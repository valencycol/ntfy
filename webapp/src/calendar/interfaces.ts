import type { TEventColor } from "@/calendar/types";

export interface IUser {
  id: string;
  name: string;
  picturePath: string | null;
}

export interface IEvent {
  /**
   * Unique per rendered occurrence, so a yearly event appearing in several
   * years of the loaded window gets a distinct React key each time. For a
   * yearly event this is `<eventId>@<year>`, otherwise it equals eventId.
   */
  id: string;
  /** The real `events.id` row UUID — what /api/events/:id expects. */
  eventId: string;
  uid: string;
  startDate: string;
  endDate: string;
  title: string;
  color: TEventColor;
  description: string;
  user: IUser;

  /** All-day events render in the multi-day row rather than the time grid. */
  allDay: boolean;
  /** Birthdays and anniversaries: the Worker re-expands these every year. */
  repeatYearly: boolean;
  /** Up to 5 "HH:MM" local times that fire an ntfy push on the event day. */
  reminderTimes: string[];
}

export interface ICalendarCell {
  day: number;
  currentMonth: boolean;
  date: Date;
}
