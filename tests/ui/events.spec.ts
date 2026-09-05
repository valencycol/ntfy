import { expect, test } from "../support/fixtures";

import { enableSuperuser, query, resetViaApi, setTime, unlock, watchForErrors } from "../support/helpers";

const chip = (page: import("@playwright/test").Page, title: string | RegExp) =>
  page.getByRole("button", { name: title }).first();

test.describe("creating, editing and deleting events", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("creates an all-day event from the Add Event button", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // A new event with no time starts out all-day, with the default reminders.
    await expect(page.getByLabel("All day")).toBeChecked();
    await expect(page.getByRole("button", { name: "Remove reminder at 12:00 am" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove reminder at 9:00 am" })).toBeVisible();

    await page.getByLabel("Title").fill("Created in the browser");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(chip(page, /Created in the browser/)).toBeVisible();

    const [row] = query<{ all_day: number; reminder_times: string }>("SELECT all_day, reminder_times FROM events WHERE title = 'Created in the browser'");
    expect(row.all_day).toBe(1);
    expect(JSON.parse(row.reminder_times)).toEqual(["00:00", "09:00"]);
    expect(errors).toEqual([]);
  });

  test("creates a timed event that stays timed", async ({ page }) => {
    // The all_day: 0 coercion bug lived here: the event round-tripped as all-day.
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await page.getByLabel("Title").fill("Timed in the browser");
    await page.getByLabel("All day").click();

    await expect(page.getByText("Start time")).toBeVisible();
    await setTime(page, "Start time", "10:30");
    await setTime(page, "End time", "11:30");

    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [row] = query<{ all_day: number; start_time: string; end_time: string }>(
      "SELECT all_day, start_time, end_time FROM events WHERE title = 'Timed in the browser'"
    );
    expect(row.all_day).toBe(0);
    expect(row.start_time).toBe("10:30");
    expect(row.end_time).toBe("11:30");
  });

  test("auto-syncs a reminder 15 minutes before a timed start", async ({ page }) => {
    await unlock(page);

    await chip(page, /Dentist/).click();
    await page.getByRole("button", { name: "Edit" }).click();

    // Seeded 14:00 start, so 1:45 pm should already be listed.
    await expect(page.getByRole("button", { name: "Remove reminder at 1:45 pm" })).toBeVisible();

    // Move the start to 16:00 and the auto entry should follow to 3:45 pm.
    await setTime(page, "Start time", "16:00");

    await expect(page.getByRole("button", { name: "Remove reminder at 3:45 pm" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove reminder at 1:45 pm" })).toHaveCount(0);
  });

  test("keeps hand-typed reminders when the start time moves", async ({ page }) => {
    await unlock(page);

    await chip(page, /Dentist/).click();
    await page.getByRole("button", { name: "Edit" }).click();

    // 12:00 am and 9:00 am were typed, not derived — they must survive.
    await setTime(page, "Start time", "16:00");
    await expect(page.getByRole("button", { name: "Remove reminder at 12:00 am" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove reminder at 9:00 am" })).toBeVisible();
  });

  test("refuses to add more than five reminders", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await page.getByLabel("Title").fill("Reminder cap");

    // Two defaults exist; add three more, then the input should disappear.
    for (const time of ["07:00", "08:00", "10:00"]) {
      await page.getByLabel("New reminder time").fill(time);
      await page.getByRole("button", { name: "Add" }).click();
    }
    await expect(page.getByLabel("New reminder time")).toHaveCount(0);
  });

  test("removes a reminder with its chip button", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await page.getByRole("button", { name: "Remove reminder at 12:00 am" }).click();
    await expect(page.getByRole("button", { name: "Remove reminder at 12:00 am" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove reminder at 9:00 am" })).toBeVisible();
  });

  test("shows event details, then edits from the same place", async ({ page }) => {
    await unlock(page);

    await chip(page, /Conference/).click();
    const details = page.getByRole("dialog");
    await expect(details.getByText("All day")).toBeVisible();
    await expect(details.getByText("Three days")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();

    // The details dialog must close rather than stack behind the editor.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByLabel("Title")).toHaveValue("Conference");
  });

  test("renames an event and the chip updates", async ({ page }) => {
    await unlock(page);
    await enableSuperuser(page);

    await chip(page, /Standup/).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Title").fill("Renamed standup");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(chip(page, /Renamed standup/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Standup/ })).toHaveCount(0);
  });

  test("blocks saving without a title", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("Title is required")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("deleting is refused until superuser is switched on", async ({ page }) => {
    await unlock(page);

    await chip(page, /Standup/).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();

    await page.keyboard.press("Escape");
    expect(query("SELECT * FROM events WHERE title = 'Standup'")).toHaveLength(1);
  });

  test("deletes only after a second confirming tap", async ({ page }) => {
    await unlock(page);
    await enableSuperuser(page);

    await chip(page, /Standup/).click();
    await page.getByRole("button", { name: "Edit" }).click();

    await page.getByRole("button", { name: "Delete" }).click();
    // One tap only arms it — the event must still exist.
    await expect(page.getByRole("button", { name: "Tap again to delete" })).toBeVisible();
    expect(query("SELECT * FROM events WHERE title = 'Standup'")).toHaveLength(1);

    await page.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Standup/ })).toHaveCount(0);
    expect(query("SELECT * FROM events WHERE title = 'Standup'")).toHaveLength(0);
  });

  test("toggling repeats-yearly off removes the event from later years", async ({ page }) => {
    await unlock(page);

    await chip(page, /Mum birthday/).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Repeats yearly")).toBeChecked();

    await page.getByLabel("Repeats yearly").click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.fill("#jump-year", "2028");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Mum birthday/ })).toHaveCount(0);
  });

  test("a yearly event appears in several consecutive years", async ({ page }) => {
    await unlock(page);

    for (const year of ["2027", "2028", "2029"]) {
      await page.fill("#jump-year", year);
      await page.keyboard.press("Enter");
      await page.locator("#jump-month").click();
      await page.getByRole("option", { name: "September" }).click();
      await expect(chip(page, /Mum birthday/), `expected the birthday in ${year}`).toBeVisible();
    }
  });
});

test.describe("the end follows the start", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("moving the start date carries the end date with it", async ({ page }) => {
    await unlock(page);

    // Public holiday is a single day on 21 September.
    await page.getByRole("button", { name: /Public holiday/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();

    await page.getByLabel("Start date").click();
    await page.getByRole("gridcell").filter({ hasText: /^25$/ }).first().click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [row] = query<{ start_date: string; end_date: string }>("SELECT start_date, end_date FROM events WHERE title = 'Public holiday'");
    expect(row.start_date).toBe("2026-09-25");
    // The end must follow rather than stay behind on the 21st.
    expect(row.end_date).toBe("2026-09-25");
  });

  test("a multi-day event keeps its length when the start moves", async ({ page }) => {
    await unlock(page);

    // Conference runs 9-11 September: three days.
    await page.getByRole("button", { name: /Conference/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();

    await page.getByLabel("Start date").click();
    await page.getByRole("gridcell").filter({ hasText: /^16$/ }).first().click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [row] = query<{ start_date: string; end_date: string }>("SELECT start_date, end_date FROM events WHERE title = 'Conference'");
    expect(row.start_date).toBe("2026-09-16");
    expect(row.end_date, "the three-day span should be preserved").toBe("2026-09-18");
  });

  test("the 15-minute reminder follows the start time as it changes", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Dentist/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Remove reminder at 1:45 pm" })).toBeVisible();

    await setTime(page, "Start time", "12:01");
    await expect(page.getByRole("button", { name: "Remove reminder at 11:46 am" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove reminder at 1:45 pm" })).toHaveCount(0);

    // And again, so it tracks rather than sticking after the first change.
    await setTime(page, "Start time", "16:30");
    await expect(page.getByRole("button", { name: "Remove reminder at 4:15 pm" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove reminder at 11:46 am" })).toHaveCount(0);
  });

  test("a moved start still saves without a validation error", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Dentist/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();
    await setTime(page, "Start time", "12:01");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [row] = query<{ start_time: string; end_time: string }>("SELECT start_time, end_time FROM events WHERE title = 'Dentist'");
    expect(row.start_time).toBe("12:01");
    expect(row.end_time).toBe("13:01");
  });
});

test.describe("renaming needs superuser", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("the title is read-only until superuser is on", async ({ page }) => {
    await unlock(page);

    await chip(page, /Standup/).click();
    await page.getByRole("button", { name: "Edit" }).click();

    await expect(page.getByLabel("Title")).toBeDisabled();
    await expect(page.getByText(/Renaming needs superuser/)).toBeVisible();
  });

  test("other fields stay editable while the title is locked", async ({ page }) => {
    await unlock(page);

    await chip(page, /Standup/).click();
    await page.getByRole("button", { name: "Edit" }).click();

    await expect(page.getByLabel("Title")).toBeDisabled();
    await page.getByLabel("Notes").fill("Edited without superuser");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(query<{ notes: string }>("SELECT notes FROM events WHERE title = 'Standup'")[0].notes).toBe("Edited without superuser");
  });

  test("with superuser the title becomes editable", async ({ page }) => {
    await unlock(page);
    await enableSuperuser(page);

    await chip(page, /Standup/).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Title")).toBeEnabled();
  });

  test("a new event can always be named", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await expect(page.getByLabel("Title")).toBeEnabled();
  });
});

test.describe("the start follows the end", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("an end date before the start pulls the start back", async ({ page }) => {
    await unlock(page);

    // Public holiday sits on 21 September.
    await page.getByRole("button", { name: /Public holiday/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();

    await page.getByLabel("End date").click();
    await page.getByRole("gridcell").filter({ hasText: /^14$/ }).first().click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Rather than an impossible range, the start comes back with it.
    const [row] = query<{ start_date: string; end_date: string }>("SELECT start_date, end_date FROM events WHERE title = 'Public holiday'");
    expect(row.start_date).toBe("2026-09-14");
    expect(row.end_date).toBe("2026-09-14");
  });

  test("an end date after the start is left alone", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Public holiday/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();

    await page.getByLabel("End date").click();
    await page.getByRole("gridcell").filter({ hasText: /^24$/ }).first().click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [row] = query<{ start_date: string; end_date: string }>("SELECT start_date, end_date FROM events WHERE title = 'Public holiday'");
    expect(row.start_date).toBe("2026-09-21");
    expect(row.end_date).toBe("2026-09-24");
  });
});
