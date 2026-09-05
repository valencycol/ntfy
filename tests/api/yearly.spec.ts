import { expect, test } from "../support/fixtures";

import { fixtureId, resetViaApi } from "../support/helpers";

import type { APIRequestContext } from "@playwright/test";

const SEARCH_FROM = "0000-01-01";
const SEARCH_TO = "9999-12-31";

interface IRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  repeat_yearly: number;
  occurrence_year?: number;
}

async function list(api: APIRequestContext, from: string, to: string) {
  const response = await api.get(`/api/events?from=${from}&to=${to}`);
  expect(response.status()).toBe(200);
  return (await response.json()).events as IRow[];
}

const datesFor = (rows: IRow[], title: string) =>
  rows
    .filter(r => r.title === title)
    .map(r => r.start_date)
    .sort();

test.describe("yearly repeats", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("a multi-year window yields one occurrence per year", async ({ api }) => {
    // The regression that prompted this: the frontend fetches the year on
    // screen plus one either side, and every yearly event used to collapse to
    // a single occurrence, vanishing when you paged into the next year.
    const rows = await list(api, "2025-01-01", "2027-12-31");

    expect(datesFor(rows, "Mum birthday")).toEqual(["2025-09-07", "2026-09-07", "2027-09-07"]);
    expect(datesFor(rows, "Anniversary")).toEqual(["2025-10-02", "2026-10-02", "2027-10-02"]);
  });

  test("each occurrence is tagged with its year so the client can key it", async ({ api }) => {
    const rows = await list(api, "2025-01-01", "2027-12-31");
    const birthdays = rows.filter(r => r.title === "Mum birthday");

    expect(birthdays.map(r => r.occurrence_year).sort()).toEqual([2025, 2026, 2027]);
    // The row id stays the real events.id, which edits and deletes rely on.
    expect(new Set(birthdays.map(r => r.id))).toEqual(new Set([fixtureId("Mum birthday")]));
  });

  test("a single-year window yields exactly that year's occurrence", async ({ api }) => {
    const rows = await list(api, "2030-01-01", "2030-12-31");
    expect(datesFor(rows, "Mum birthday")).toEqual(["2030-09-07"]);
  });

  test("a single-month window yields the occurrence only in its own month", async ({ api }) => {
    expect(datesFor(await list(api, "2027-09-01", "2027-09-30"), "Mum birthday")).toEqual(["2027-09-07"]);
    expect(datesFor(await list(api, "2027-08-01", "2027-08-31"), "Mum birthday")).toEqual([]);
  });

  test("past years are reachable when navigating backwards", async ({ api }) => {
    const rows = await list(api, "2020-01-01", "2020-12-31");
    expect(datesFor(rows, "Mum birthday")).toEqual(["2020-09-07"]);
  });

  test("the anchor row itself is never returned at its original date", async ({ api }) => {
    // The 1968 anchor is bookkeeping, not a real occurrence to display.
    const rows = await list(api, "2026-01-01", "2026-12-31");
    expect(rows.every(r => r.start_date !== "1968-09-07")).toBeTruthy();
  });

  test("the search sentinel returns only the next upcoming occurrence", async ({ api }) => {
    const rows = await list(api, SEARCH_FROM, SEARCH_TO);

    expect(datesFor(rows, "Mum birthday")).toHaveLength(1);
    expect(datesFor(rows, "Anniversary")).toHaveLength(1);

    // ...and it must be today or later, never the long-past anchor.
    const today = new Date().toISOString().slice(0, 10);
    for (const row of rows.filter(r => r.repeat_yearly === 1)) {
      expect(row.start_date >= today, `${row.title} resolved to ${row.start_date}, which is in the past`).toBeTruthy();
    }
  });

  test("the search sentinel still returns every non-recurring event", async ({ api }) => {
    const titles = (await list(api, SEARCH_FROM, SEARCH_TO)).map(r => r.title);
    expect(titles).toContain("Standup");
    expect(titles).toContain("Conference");
    expect(titles).toContain("Public holiday");
  });

  test("a 29 February anchor only occurs in leap years", async ({ api }) => {
    expect(datesFor(await list(api, "2028-01-01", "2028-12-31"), "Leap day thing")).toEqual(["2028-02-29"]);
    expect(datesFor(await list(api, "2027-01-01", "2027-12-31"), "Leap day thing")).toEqual([]);
  });

  test("unchecking repeats-yearly removes it from later years, and re-checking restores it", async ({ api }) => {
    const id = fixtureId("Mum birthday");
    const base = {
      title: "Mum birthday",
      notes: null,
      start_date: "1968-09-07",
      end_date: "1968-09-07",
      start_time: null,
      end_time: null,
      all_day: 1,
      color: "#9333ea",
      reminder_times: ["00:00", "09:00"],
    };

    // Off: the 2028 view should no longer show it.
    expect((await api.patch(`/api/events/${id}`, { data: { ...base, repeat_yearly: 0 } })).status()).toBe(200);
    expect(datesFor(await list(api, "2028-01-01", "2028-12-31"), "Mum birthday")).toEqual([]);

    // Back on: it returns, without duplicating.
    expect((await api.patch(`/api/events/${id}`, { data: { ...base, repeat_yearly: 1 } })).status()).toBe(200);
    expect(datesFor(await list(api, "2028-01-01", "2028-12-31"), "Mum birthday")).toEqual(["2028-09-07"]);
  });

  test("a yearly multi-day span keeps its length in every occurrence", async ({ api }) => {
    const created = await api.post("/api/events", {
      data: {
        title: "Yearly festival",
        notes: null,
        start_date: "2010-06-10",
        end_date: "2010-06-13",
        start_time: null,
        end_time: null,
        all_day: 1,
        color: "#16a34a",
        repeat_yearly: 1,
        reminder_times: [],
      },
    });
    expect(created.status()).toBe(200);

    const rows = (await list(api, "2027-01-01", "2027-12-31")).filter(r => r.title === "Yearly festival");
    expect(rows).toHaveLength(1);
    expect(rows[0].start_date).toBe("2027-06-10");
    expect(rows[0].end_date).toBe("2027-06-13");
  });

  test("an absurdly wide explicit range is bounded rather than expanding forever", async ({ api }) => {
    const rows = await list(api, "1900-01-01", "2400-12-31");
    // Capped at 200 years per request, so a five-century ask cannot make the
    // Worker grind — but nothing inside the calendar's own range is lost.
    expect(datesFor(rows, "Mum birthday").length).toBeLessThanOrEqual(201);
    expect(rows.length).toBeLessThan(2000);
  });
});

test.describe("how far ahead yearly events reach", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  // The year box accepts up to 2200, so a birthday has to exist that far out.
  for (const year of [2030, 2076, 2077, 2100, 2200]) {
    test(`a birthday still appears in ${year}`, async ({ api }) => {
      const rows = await list(api, `${year}-01-01`, `${year}-12-31`);
      expect(datesFor(rows, "Mum birthday"), `nothing in ${year}`).toEqual([`${year}-09-07`]);
    });
  }

  test("every yearly event reaches the same horizon, with no disparity", async ({ api }) => {
    // Two events anchored decades apart must behave identically.
    for (const year of [2076, 2077, 2150]) {
      const rows = await list(api, `${year}-01-01`, `${year}-12-31`);
      expect(datesFor(rows, "Mum birthday"), `birthday missing in ${year}`).toHaveLength(1);
      expect(datesFor(rows, "Anniversary"), `anniversary missing in ${year}`).toHaveLength(1);
    }
  });

  test("beyond the calendar's own range nothing is expanded", async ({ api }) => {
    const rows = await list(api, "2250-01-01", "2250-12-31");
    expect(datesFor(rows, "Mum birthday")).toEqual([]);
  });
});
