import { expect, test } from "../support/fixtures";

import { fixtureId, query, resetViaApi } from "../support/helpers";

interface IRow {
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  all_day: number;
  repeat_yearly: number;
}

/** Mirrors what the browser sends after parsing an .ics client-side. */
const parsed = {
  birthday: {
    title: "Alice Birthday",
    notes: null,
    uid: "fixture-birthday-001",
    all_day: true,
    start_date: "1990-03-15",
    end_date: "1990-03-15",
    repeat_yearly: true,
    reminder_times: ["00:00", "09:00"],
  },
  offsite: {
    title: "Team Offsite",
    notes: null,
    uid: "fixture-offsite-002",
    all_day: true,
    start_date: "2026-10-12",
    end_date: "2026-10-14",
    repeat_yearly: false,
    reminder_times: ["09:00"],
  },
  call: {
    title: "Client call",
    notes: null,
    uid: "fixture-call-003",
    all_day: false,
    start_date: "2026-09-22",
    end_date: "2026-09-22",
    start_time: "15:00",
    end_time: "16:00",
    repeat_yearly: false,
    reminder_times: ["14:45"],
  },
};

test.describe("import API", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("imports a batch and reports the count", async ({ api }) => {
    const response = await api.post("/api/import", { data: { events: Object.values(parsed) } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 3, rejected: 0 });

    const rows = query<IRow>("SELECT * FROM events WHERE uid LIKE 'fixture-%' ORDER BY uid");
    expect(rows).toHaveLength(3);
  });

  test("stores a yearly birthday at its anchor date, flagged as recurring", async ({ api }) => {
    await api.post("/api/import", { data: { events: [parsed.birthday] } });

    const [row] = query<IRow>("SELECT * FROM events WHERE uid = 'fixture-birthday-001'");
    expect(row.start_date).toBe("1990-03-15");
    expect(row.all_day).toBe(1);
    expect(row.repeat_yearly).toBe(1);
    expect(row.start_time).toBeNull();
  });

  test("keeps an inclusive end date for a multi-day all-day span", async ({ api }) => {
    await api.post("/api/import", { data: { events: [parsed.offsite] } });

    const [row] = query<IRow>("SELECT * FROM events WHERE uid = 'fixture-offsite-002'");
    // DTEND was the exclusive 2026-10-15; the stored end is the last real day.
    expect(row.start_date).toBe("2026-10-12");
    expect(row.end_date).toBe("2026-10-14");
    expect(row.all_day).toBe(1);
  });

  test("re-importing the same UID does not duplicate or double up reminders", async ({ api }) => {
    const first = await api.post("/api/import", { data: { events: [parsed.call] } });
    expect((await first.json()).imported).toBe(1);

    const remindersAfterFirst = query("SELECT * FROM reminders r JOIN events e ON e.id = r.event_id WHERE e.uid = 'fixture-call-003'").length;

    const second = await api.post("/api/import", { data: { events: [parsed.call] } });
    expect((await second.json()).imported).toBe(0);

    expect(query("SELECT * FROM events WHERE uid = 'fixture-call-003'")).toHaveLength(1);
    expect(query("SELECT * FROM reminders r JOIN events e ON e.id = r.event_id WHERE e.uid = 'fixture-call-003'").length).toBe(remindersAfterFirst);
  });

  test("counts invalid rows as rejected instead of failing the whole batch", async ({ api }) => {
    const response = await api.post("/api/import", {
      data: { events: [parsed.call, { ...parsed.offsite, uid: "fixture-bad", title: "" }] },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 1, rejected: 1 });
  });

  test("rejects a payload that is not a list", async ({ api }) => {
    const response = await api.post("/api/import", { data: { events: "nope" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/nothing to import/i);
  });

  test("refuses an oversized batch", async ({ api }) => {
    const events = Array.from({ length: 1001 }, (_, i) => ({ ...parsed.call, uid: `bulk-${i}` }));
    const response = await api.post("/api/import", { data: { events } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/1000/);
  });

  test("an empty list imports nothing without erroring", async ({ api }) => {
    const response = await api.post("/api/import", { data: { events: [] } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 0 });
  });

  test.describe("fetching a remote calendar link", () => {
    test("refuses a non-HTTP scheme", async ({ api }) => {
      const response = await api.post("/api/import/fetch", { data: { url: "file:///etc/passwd" } });
      expect(response.status()).toBe(400);
    });

    test("refuses a missing url", async ({ api }) => {
      const response = await api.post("/api/import/fetch", { data: {} });
      expect(response.status()).toBe(400);
    });

    test("refuses a private-network address", async ({ api }) => {
      // Server-side fetching must not become an SSRF pivot into the LAN.
      const response = await api.post("/api/import/fetch", { data: { url: "http://169.254.169.254/latest/meta-data/" } });
      expect(response.status()).toBe(400);
    });
  });
});
