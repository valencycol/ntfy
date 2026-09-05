import type { IEvent } from "@/calendar/interfaces";
import type { TEventColor } from "@/calendar/types";

/** A row exactly as the Cloudflare Worker stores and returns it. */
export interface IEventRow {
  id: string;
  uid: string;
  title: string;
  notes: string | null;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  start_time: string | null; // HH:MM
  end_time: string | null;
  all_day: number; // 0 | 1
  color: string; // #rrggbb
  repeat_yearly: number; // 0 | 1
  reminder_times: string | string[]; // JSON text from D1
  /** Present only on yearly events, which the Worker expands per year. */
  occurrence_year?: number;
}

// The Worker's PALETTE, in the same order as big-calendar's TEventColor union,
// so the two representations convert without a lookup table per direction.
const HEXES = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#9333ea", "#ea580c", "#525252"] as const;
const NAMES: TEventColor[] = ["blue", "green", "red", "yellow", "purple", "orange", "gray"];

export function hexToName(hex: string): TEventColor {
  const i = HEXES.indexOf(hex?.toLowerCase() as (typeof HEXES)[number]);
  return i === -1 ? "blue" : NAMES[i];
}

export function nameToHex(name: TEventColor): string {
  const i = NAMES.indexOf(name);
  return i === -1 ? HEXES[0] : HEXES[i];
}

function parseReminderTimes(value: IEventRow["reminder_times"]): string[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * All-day events are stored as bare dates and are inclusive of end_date. The
 * calendar views work in local Date objects, so an all-day event spans from
 * 00:00 on start_date to 23:59:59 on end_date.
 */
export function rowToEvent(row: IEventRow): IEvent {
  const allDay = row.all_day === 1;
  const startDate = `${row.start_date}T${allDay ? "00:00" : (row.start_time ?? "00:00")}:00`;
  const endDate = `${row.end_date}T${allDay ? "23:59" : (row.end_time ?? row.start_time ?? "23:59")}:59`;

  return {
    id: row.occurrence_year ? `${row.id}@${row.occurrence_year}` : row.id,
    eventId: row.id,
    uid: row.uid,
    title: row.title,
    description: row.notes ?? "",
    startDate,
    endDate,
    color: hexToName(row.color),
    allDay,
    repeatYearly: row.repeat_yearly === 1,
    reminderTimes: parseReminderTimes(row.reminder_times),
    user: { id: "me", name: "Me", picturePath: null },
  };
}

/** The payload shape /api/events accepts for POST and PATCH. */
export function eventToPayload(event: IEvent) {
  const [startDatePart, startTimePart] = event.startDate.split("T");
  const [endDatePart, endTimePart] = event.endDate.split("T");

  return {
    title: event.title,
    notes: event.description,
    start_date: startDatePart,
    end_date: endDatePart,
    start_time: event.allDay ? null : (startTimePart ?? "").slice(0, 5) || null,
    end_time: event.allDay ? null : (endTimePart ?? "").slice(0, 5) || null,
    all_day: event.allDay ? 1 : 0,
    color: nameToHex(event.color),
    repeat_yearly: event.repeatYearly ? 1 : 0,
    reminder_times: event.reminderTimes,
  };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Every call is same-origin and carries the session cookie. A 401 means the
 * session lapsed; callers surface that by sending the user back to the lock.
 */
export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page; fall through to the status-based message */
  }

  if (!response.ok) {
    throw new ApiError(String(body.error || `Request failed (${response.status})`), response.status);
  }
  return body as T;
}

export async function fetchEvents(from: string, to: string): Promise<IEvent[]> {
  const { events } = await api<{ events: IEventRow[] }>(`/api/events?from=${from}&to=${to}`);
  return events.map(rowToEvent);
}

/**
 * Every event in the database, for search. The Worker treats this wide-open
 * range as the search sentinel: plain events come back for all years, and each
 * yearly event resolves to its next upcoming occurrence rather than its
 * long-past anchor date.
 */
export function fetchAllEvents(): Promise<IEvent[]> {
  return fetchEvents("0000-01-01", "9999-12-31");
}
