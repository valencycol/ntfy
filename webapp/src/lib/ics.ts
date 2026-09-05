/**
 * iCalendar (RFC 5545) parsing, ported from the previous single-file app. The
 * quirks handled here — Google's midnight-to-midnight "fake all-day" encoding
 * and yearly RRULE anchors — were each found against real exports, so the
 * behaviour is kept exactly as it was.
 */

export interface IParsedDate {
  allDay: boolean;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  foreignTz?: boolean;
}

export interface IVEvent {
  title?: string;
  notes?: string;
  uid?: string;
  rrule?: string;
  start?: IParsedDate;
  end?: IParsedDate;
}

/** The payload shape /api/import accepts, one per staged row. */
export interface IImportEvent {
  title: string;
  notes: string | null;
  uid: string | null;
  all_day: boolean;
  start_date: string;
  end_date: string;
  start_time?: string;
  end_time?: string;
  repeat_yearly: boolean;
  reminder_times: string[];
}

export const DEFAULT_REMINDER_TIMES = ["00:00", "09:00"];

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function iso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(dateStr: string, delta: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return iso(date);
}

function unescapeICS(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseICSDate(value: string, params: string[]): IParsedDate | null {
  const isDate = params.some(p => /^VALUE=DATE$/i.test(p)) || /^\d{8}$/.test(value);

  if (isDate) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    return m ? { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}` } : null;
  }

  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;

  if (m[7] === "Z") {
    const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return { allDay: false, date: iso(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
  }

  // Floating or TZID-qualified: treat the written wall time as local. Events
  // from a calendar in another timezone will be off, which the import list flags.
  const tzid = params.find(p => /^TZID=/i.test(p));
  return {
    allDay: false,
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}`,
    foreignTz: tzid ? tzid.slice(5) !== TZ : false,
  };
}

export function parseICS(text: string): IVEvent[] {
  // RFC 5545 folds long lines with CRLF + a space or tab. Unfold before splitting.
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IVEvent[] = [];
  let cur: IVEvent | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...params] = left.split(";");
    const key = name.toUpperCase();

    if (key === "SUMMARY") cur.title = unescapeICS(value);
    else if (key === "DESCRIPTION") cur.notes = unescapeICS(value);
    else if (key === "UID") cur.uid = value.trim();
    else if (key === "RRULE") cur.rrule = value.trim();
    else if (key === "DTSTART" || key === "DTEND") {
      const parsed = parseICSDate(value.trim(), params);
      if (parsed) cur[key === "DTSTART" ? "start" : "end"] = parsed;
    }
  }

  return out;
}

export function isYearlyRRule(rrule?: string) {
  return !!rrule && /(^|;)FREQ=YEARLY(;|$)/i.test(rrule);
}

/**
 * Display-only preview of when a yearly-recurring event next lands. Mirrors the
 * Worker's nextYearlyOccurrence; the stored anchor stays the original date.
 */
export function nextOccurrencePreview(anchorDate: string) {
  const [, m, d] = anchorDate.split("-").map(Number);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let candidate = new Date(today.getFullYear(), m - 1, d);
  if (candidate < todayMidnight) candidate = new Date(today.getFullYear() + 1, m - 1, d);
  return iso(candidate);
}

export function icsToEvent(v: IVEvent): IImportEvent | null {
  if (!v.start || !v.title) return null;

  const start = v.start;
  const end = v.end || v.start;
  const yearly = isYearlyRRule(v.rrule);

  // Google exports some auto-generated all-day events (birthdays synced from
  // Contacts, and similar) as a midnight-to-midnight TIMED span with a TZID
  // rather than a VALUE=DATE — semantically all-day despite looking timed.
  const fakeAllDay = !start.allDay && !end.allDay && start.time === "00:00" && end.time === "00:00" && end.date > start.date;

  if (start.allDay || fakeAllDay) {
    // DTEND is exclusive either way, so the last real day is one before.
    const endDate = end.date > start.date ? addDays(end.date, -1) : start.date;
    return {
      title: v.title,
      notes: v.notes || null,
      uid: v.uid || null,
      all_day: true,
      start_date: start.date,
      end_date: endDate,
      repeat_yearly: yearly,
      reminder_times: DEFAULT_REMINDER_TIMES,
    };
  }

  return {
    title: v.title,
    notes: v.notes || null,
    uid: v.uid || null,
    all_day: false,
    start_date: start.date,
    end_date: end.date || start.date,
    start_time: start.time,
    end_time: end.time || start.time,
    repeat_yearly: yearly,
    reminder_times: DEFAULT_REMINDER_TIMES,
  };
}

/** Google exports .zip archives; the PK magic bytes give a clear early error. */
export function looksLikeZip(text: string) {
  return text.startsWith("PK");
}
