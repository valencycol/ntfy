import path from "node:path";

import { expect, test } from "../support/fixtures";

import { addReminderViaApi, clearStub, enableSuperuser, query, resetViaApi, setTime, stubPushes, unlock, watchForErrors } from "../support/helpers";

const FIXTURES = path.join(__dirname, "..", "fixtures");

const openMenu = async (page: import("@playwright/test").Page, item: string) => {
  await page.getByRole("button", { name: /Colaco Calendar/ }).click();
  await page.getByRole("button", { name: item, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

/** Nothing should ever be reachable only by scrolling the page sideways. */
const expectNoSideScroll = async (page: import("@playwright/test").Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `the page scrolls ${overflow}px sideways`).toBeLessThanOrEqual(1);
};

test.describe("event flows on a phone", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("creates an all-day event end to end", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await page.getByLabel("Title").fill("Phone all-day");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [row] = query<{ all_day: number }>("SELECT all_day FROM events WHERE title = 'Phone all-day'");
    expect(row.all_day).toBe(1);
    expect(errors).toEqual([]);
  });

  test("creates a timed event with the time fields", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();
    await page.getByLabel("Title").fill("Phone timed");
    await page.getByLabel("All day").click();

    await setTime(page, "Start time", "18:00");
    await setTime(page, "End time", "19:30");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const [row] = query<{ all_day: number; start_time: string; end_time: string }>(
      "SELECT all_day, start_time, end_time FROM events WHERE title = 'Phone timed'"
    );
    expect(row.all_day).toBe(0);
    expect(row.start_time).toBe("18:00");
    expect(row.end_time).toBe("19:30");
  });

  test("edits and deletes an event from the day list", async ({ page }) => {
    await unlock(page);
    await enableSuperuser(page);

    // The month grid shows colour bullets on a phone; titles live in the day
    // list, which is how you actually reach an event there.
    await page.getByRole("button", { name: /on 4 September 2026/ }).click();
    // Picking from the list hands straight to the editor — no Edit step.
    await page.getByRole("dialog").getByRole("button", { name: /Standup/ }).click();
    await expect(page.getByLabel("Title")).toHaveValue("Standup");
    await page.getByLabel("Title").fill("Phone renamed");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(query("SELECT * FROM events WHERE title = 'Phone renamed'")).toHaveLength(1);

    await page.getByRole("button", { name: /on 4 September 2026/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Phone renamed/ }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Tap again to delete" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(query("SELECT * FROM events WHERE title = 'Phone renamed'")).toHaveLength(0);
  });

  test("the editor's Save and Delete stay reachable in the dialog", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /on 4 September 2026/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Standup/ }).click();

    // The form is taller than the screen, so the footer must be scrolled to
    // rather than clipped away.
    const save = page.getByRole("button", { name: "Save" });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
    await expectNoSideScroll(page);
  });

  test("month tiles mark their events with labelled colour bullets", async ({ page }) => {
    await unlock(page);

    // Titled badges only appear from `lg` up; a phone gets one dot per event,
    // which must still announce itself rather than being a decorative div.
    const bullets = page.locator("[data-event-bullet]");
    expect(await bullets.count()).toBeGreaterThan(0);
    await expect(bullets.first()).toHaveAttribute("aria-label", /^Event/);
  });

  test("tapping a day with events opens them as a list, not the day view", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "4", exact: true }).first().click();

    // A modal, rather than navigating away — jumping to the day view on a
    // single tap was too abrupt.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /4 September 2026/ })).toBeVisible();
    await expect(page.getByRole("dialog").locator("li button")).toHaveCount(3);
  });

  test("tapping an empty day offers to add an event on it", async ({ page }) => {
    await unlock(page);

    // The 14th has nothing on it in the fixtures.
    await page.getByRole("button", { name: "14", exact: true }).first().click();

    await expect(page.getByRole("heading", { name: "Add event" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("");
    await expect(page.getByText("September 14th, 2026").first()).toBeVisible();
  });
});

test.describe("navigation and search on a phone", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("the jump fields ask for a numeric keypad", async ({ page }) => {
    await unlock(page);
    // inputMode drives which keyboard iOS shows.
    await expect(page.locator("#jump-week")).toHaveAttribute("inputmode", "numeric");
    await expect(page.locator("#jump-year")).toHaveAttribute("inputmode", "numeric");
  });

  test("the month dropdown opens and picks a month", async ({ page }) => {
    await unlock(page);

    await page.locator("#jump-month").click();
    await page.getByRole("option", { name: "December" }).click();
    await expect(page.getByText(/Dec 1, 2026 - Dec 31, 2026/)).toBeVisible();
    await expectNoSideScroll(page);
  });

  test("Today and the year box work together", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-year", "2029");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/2029/).first()).toBeVisible();

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText(new RegExp(String(new Date().getFullYear()))).first()).toBeVisible();
  });

  test("search results stay inside the screen", async ({ page }) => {
    await unlock(page);

    await page.getByLabel("Search all events").fill("mum");
    const result = page.locator("div.absolute button").first();
    await expect(result).toContainText("Mum birthday");

    const box = (await result.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await expectNoSideScroll(page);
  });

  test("tapping a search result navigates and closes the panel", async ({ page }) => {
    await unlock(page);

    await page.getByLabel("Search all events").fill("anniversary");
    await page.locator("div.absolute button").first().click();

    await expect(page.getByText(/Oct 1, \d{4} - Oct 31, \d{4}/)).toBeVisible();
    await expect(page.locator("div.absolute button")).toHaveCount(0);
  });

  test("the view switcher reaches day, month, year and agenda", async ({ page }) => {
    await unlock(page);

    for (const label of ["View by day", "View by year", "View by agenda", "View by month"]) {
      await page.getByRole("link", { name: label }).click();
      await page.waitForTimeout(500);
      await expectNoSideScroll(page);
    }
  });
});

test.describe("menu dialogs on a phone", () => {
  test.beforeEach(async ({ api, admin }) => {
    await resetViaApi(admin);
    await clearStub(api);
  });

  for (const item of ["Import", "iPhone setup", "Notifications", "Calendar settings"]) {
    test(`${item} fits the screen and closes`, async ({ page }) => {
      await unlock(page);
      await openMenu(page, item);

      const dialog = (await page.getByRole("dialog").boundingBox())!;
      const viewport = page.viewportSize()!;

      expect(dialog.x, `${item} overflows the left edge`).toBeGreaterThanOrEqual(0);
      expect(dialog.x + dialog.width, `${item} overflows the right edge`).toBeLessThanOrEqual(viewport.width + 1);
      expect(dialog.height, `${item} is taller than the screen`).toBeLessThanOrEqual(viewport.height);

      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }

  test("iPhone setup shows the copy buttons within the dialog", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "iPhone setup");

    const dialog = (await page.getByRole("dialog").boundingBox())!;
    for (const label of ["Copy Server", "Copy Topic", "Copy Subscription URL"]) {
      const button = (await page.getByRole("button", { name: label }).boundingBox())!;
      expect(button.x + button.width, `${label} is clipped`).toBeLessThanOrEqual(dialog.x + dialog.width + 1);
    }
  });

  test("notifications sends an ad-hoc message", async ({ page, api }) => {
    await unlock(page);
    await openMenu(page, "Notifications");

    const box = page.getByPlaceholder("Send a message to your phone…");
    await box.fill("Sent from the phone");
    await box.press("Enter");
    await expect(page.getByText("Sent.")).toBeVisible();

    expect(JSON.stringify(await stubPushes(api))).toContain("Sent from the phone");
  });

  test("notifications lists a due reminder with both actions reachable", async ({ page, api }) => {
    // Armed through the API, which also proves it landed before we look.
    await addReminderViaApi(api, "Dentist", 30);

    await unlock(page);
    await openMenu(page, "Notifications");

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Dentist")).toBeVisible();

    const bounds = (await dialog.boundingBox())!;
    for (const label of ["Send now", "Cancel"]) {
      const button = (await dialog.getByRole("button", { name: label }).boundingBox())!;
      expect(button.x + button.width, `${label} is clipped`).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }
  });

  test("import stages a file and its list scrolls inside the dialog", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");

    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));
    await expect(page.locator('input[aria-label="Event title"]')).toHaveCount(4);

    await expectNoSideScroll(page);
    const button = page.getByRole("button", { name: /^Import \d+ events?$/ });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
  });

  test("import completes from the phone", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");

    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));
    await page.getByRole("button", { name: /^Import \d+ events?$/ }).click();
    await expect(page.getByText(/Imported 4/)).toBeVisible();
  });

  test("calendar settings Apply confirms itself", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Calendar settings");

    await page.getByRole("button", { name: "Apply" }).first().click();
    await expect(page.getByRole("status").first()).toContainText(/Showing/);
  });

  test("Lock returns to the lock screen", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Colaco Calendar/ }).click();
    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await expect(page.locator(".lock")).toBeVisible({ timeout: 15_000 });
  });

  test("the theme toggle works and persists", async ({ page }) => {
    await unlock(page);

    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(page.locator("html")).toHaveClass(/light/);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/light/);
  });
});
