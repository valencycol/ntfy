import { expect, test } from "../support/fixtures";

import { fixtureId, query, resetViaApi } from "../support/helpers";

interface IRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: number;
  color: string;
  repeat_yearly: number;
  reminder_times: string | string[];
  occurrence_year?: number;
}

const validEvent = {
  title: "New event",
  notes: "Some notes",
  start_date: "2026-09-15",
  end_date: "2026-09-15",
  start_time: "10:00",
  end_time: "11:00",
  all_day: 0,
  color: "#2563eb",
  repeat_yearly: 0,
  reminder_times: ["09:45"],
};

test.describe("events API", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  const list = async (api: import("@playwright/test").APIRequestContext, from: string, to: string) => {
    const response = await api.get(`/api/events?from=${from}&to=${to}`);
    expect(response.status()).toBe(200);
    return (await response.json()).events as IRow[];
  };

  test("returns only events overlapping the requested range", async ({ api }) => {
    const september = await list(api, "2026-09-01", "2026-09-30");
    const titles = september.map(e => e.title);

    expect(titles).toContain("Standup");
    expect(titles).toContain("Conference");
    expect(titles).toContain("Public holiday");
    // October's anniversary must not appear in a September-only window.
    expect(titles).not.toContain("Anniversary");
  });

  test("includes a multi-day event when the range only touches its middle", async ({ api }) => {
    // Conference runs 9–11 September; ask for the 10th alone.
    const rows = await list(api, "2026-09-10", "2026-09-10");
    expect(rows.map(e => e.title)).toContain("Conference");
  });

  test("orders results by date, then all-day first, then start time", async ({ api }) => {
    const rows = await list(api, "2026-09-01", "2026-09-30");
    const keys = rows.map(e => `${e.start_date}|${1 - e.all_day}|${e.start_time ?? ""}`);
    expect(keys).toEqual([...keys].sort());
  });

  test("creates an event and derives its reminder rows", async ({ api }) => {
    const created = await api.post("/api/events", { data: validEvent });
    expect(created.status()).toBe(200);
    const { id } = await created.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = query<IRow>(`SELECT * FROM events WHERE id = '${id}'`);
    expect(row.title).toBe("New event");
    expect(row.start_time).toBe("10:00");
    expect(row.all_day).toBe(0);
    expect(JSON.parse(row.reminder_times as string)).toEqual(["09:45"]);

    const reminders = query(`SELECT * FROM reminders WHERE event_id = '${id}'`);
    expect(reminders).toHaveLength(1);
  });

  test("keeps a timed event timed when all_day arrives as the number 0", async ({ api }) => {
    // Regression: `input.all_day !== false` treated 0 as all-day, so every
    // timed event created or edited in the UI silently lost its clock time.
    const created = await api.post("/api/events", { data: { ...validEvent, all_day: 0, start_time: "10:00", end_time: "11:00" } });
    expect(created.status()).toBe(200);
    const { id } = await created.json();

    const [row] = query<IRow>(`SELECT * FROM events WHERE id = '${id}'`);
    expect(row.all_day).toBe(0);
    expect(row.start_time).toBe("10:00");
    expect(row.end_time).toBe("11:00");
  });

  test("treats all_day true, 1 and absent as all-day", async ({ api }) => {
    for (const allDay of [true, 1, undefined]) {
      const payload: Record<string, unknown> = { ...validEvent, start_time: null, end_time: null };
      if (allDay === undefined) delete payload.all_day;
      else payload.all_day = allDay;

      const created = await api.post("/api/events", { data: { ...payload, title: `All day ${String(allDay)}` } });
      expect(created.status(), `all_day=${String(allDay)}: ${await created.text()}`).toBe(200);
      const { id } = await created.json();
      const [row] = query<IRow>(`SELECT all_day, start_time FROM events WHERE id = '${id}'`);
      expect(row.all_day, `all_day=${String(allDay)} should store as all-day`).toBe(1);
      expect(row.start_time).toBeNull();
    }
  });

  test("an event with no reminder times creates no reminder rows", async ({ api }) => {
    const created = await api.post("/api/events", { data: { ...validEvent, reminder_times: [] } });
    const { id } = await created.json();
    expect(query(`SELECT * FROM reminders WHERE event_id = '${id}'`)).toHaveLength(0);
  });

  test.describe("validation", () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["a missing title", { ...validEvent, title: "" }, /title/i],
      ["a whitespace-only title", { ...validEvent, title: "   " }, /title/i],
      ["a malformed start date", { ...validEvent, start_date: "15/09/2026" }, /date/i],
      ["an end date before the start", { ...validEvent, start_date: "2026-09-15", end_date: "2026-09-14" }, /date/i],
      ["a malformed time", { ...validEvent, start_time: "25:00" }, /time/i],
      ["more than five reminders", { ...validEvent, reminder_times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00"] }, /5 reminder/i],
      ["a malformed reminder time", { ...validEvent, reminder_times: ["9am"] }, /reminder/i],
    ];

    for (const [label, payload, expected] of cases) {
      test(`rejects ${label}`, async ({ api }) => {
        const response = await api.post("/api/events", { data: payload });
        expect(response.status()).toBe(400);
        expect((await response.json()).error).toMatch(expected);
      });
    }

    test("assigns a palette colour instead of rejecting an unusable one", async ({ api }) => {
      // Documented behaviour: "no colour picked is a normal case, not an error".
      const created = await api.post("/api/events", { data: { ...validEvent, color: "red" } });
      expect(created.status()).toBe(200);
      const { id } = await created.json();
      const [row] = query<IRow>(`SELECT color FROM events WHERE id = '${id}'`);
      expect(row.color).toMatch(/^#[0-9a-f]{6}$/);
    });

    test("rejects a malformed JSON body", async ({ api }) => {
      const response = await api.post("/api/events", { headers: { "content-type": "application/json" }, data: "{oops" });
      expect(response.status()).toBe(400);
    });
  });

  test("patches an event in place", async ({ admin: api }) => {
    const id = fixtureId("Standup");
    const response = await api.patch(`/api/events/${id}`, {
      data: { ...validEvent, title: "Renamed standup", start_date: "2026-09-04", end_date: "2026-09-04", start_time: "09:30", end_time: "09:45" },
    });
    expect(response.status()).toBe(200);

    const [row] = query<IRow>(`SELECT * FROM events WHERE id = '${id}'`);
    expect(row.title).toBe("Renamed standup");
    expect(row.start_time).toBe("09:30");
  });

  test("patching replaces the reminder set rather than appending to it", async ({ admin: api }) => {
    const id = fixtureId("Dentist"); // seeded with three reminder times
    await api.patch(`/api/events/${id}`, { data: { ...validEvent, start_date: "2026-09-04", end_date: "2026-09-04", reminder_times: ["08:00"] } });

    const [row] = query<IRow>(`SELECT reminder_times FROM events WHERE id = '${id}'`);
    expect(JSON.parse(row.reminder_times as string)).toEqual(["08:00"]);
    expect(query(`SELECT * FROM reminders WHERE event_id = '${id}'`).length).toBeLessThanOrEqual(1);
  });

  test("deletes an event and cascades to its reminders", async ({ admin: api }) => {
    const id = fixtureId("Dentist");
    expect(query(`SELECT * FROM events WHERE id = '${id}'`)).toHaveLength(1);

    const response = await api.delete(`/api/events/${id}`);
    expect(response.status()).toBe(200);

    expect(query(`SELECT * FROM events WHERE id = '${id}'`)).toHaveLength(0);
    expect(query(`SELECT * FROM reminders WHERE event_id = '${id}'`)).toHaveLength(0);
  });

  test("ignores a non-UUID id rather than matching a row by accident", async ({ admin: api }) => {
    const response = await api.delete("/api/events/not-a-uuid");
    expect(response.status()).toBe(404);
    expect(query("SELECT * FROM events").length).toBeGreaterThan(0);
  });

  test("deduplicates and sorts reminder times", async ({ api }) => {
    const created = await api.post("/api/events", { data: { ...validEvent, reminder_times: ["09:00", "08:00", "09:00"] } });
    const { id } = await created.json();
    const [row] = query<IRow>(`SELECT reminder_times FROM events WHERE id = '${id}'`);
    expect(JSON.parse(row.reminder_times as string)).toEqual(["08:00", "09:00"]);
  });
});
