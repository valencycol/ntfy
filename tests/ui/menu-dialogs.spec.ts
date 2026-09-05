import path from "node:path";

import { expect, test } from "../support/fixtures";

import { addReminderViaApi, clearStub, query, resetViaApi, stubPushes, unlock, watchForErrors } from "../support/helpers";

const FIXTURES = path.join(__dirname, "..", "fixtures");

const openMenu = async (page: import("@playwright/test").Page, item: string) => {
  await page.getByRole("button", { name: /Colaco Calendar/ }).click();
  await page.getByRole("button", { name: item, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test.describe("the Colaco Calendar menu", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("offers Import, iPhone setup, Notifications, Calendar settings and Lock", async ({ page }) => {
    await unlock(page);
    await page.getByRole("button", { name: /Colaco Calendar/ }).click();

    for (const item of ["Import", "iPhone setup", "Notifications", "Calendar settings", "Lock"]) {
      await expect(page.getByRole("button", { name: item, exact: true })).toBeVisible();
    }
  });

  test("Lock returns to the lock screen and re-gates the calendar", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Colaco Calendar/ }).click();
    await page.getByRole("button", { name: "Lock", exact: true }).click();

    await expect(page.locator(".lock")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Add Event" })).toHaveCount(0);
  });

  test("every dialog closes with its X button", async ({ page }) => {
    await unlock(page);

    for (const item of ["Import", "iPhone setup", "Notifications", "Calendar settings"]) {
      await openMenu(page, item);
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("dialog"), `${item} should close`).toHaveCount(0);
    }
  });
});

test.describe("calendar settings dialog", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("opens as a modal with all three controls", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);
    await openMenu(page, "Calendar settings");

    await expect(page.getByText("Change badge variant")).toBeVisible();
    await expect(page.getByText("Change visible hours")).toBeVisible();
    await expect(page.getByText("Change working hours")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Apply confirms what it did rather than looking inert", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Calendar settings");

    await page.getByRole("button", { name: "Apply" }).first().click();
    await expect(page.getByRole("status").first()).toContainText(/Showing \d+(am|pm) to \d+(am|pm)/);
  });

  test("the badge variant setting changes how events are drawn", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Calendar settings");

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Dot" }).click();
    await page.getByRole("button", { name: "Close" }).click();

    await expect(page.locator("svg.event-dot").first()).toBeVisible();
  });
});

test.describe("iPhone setup dialog", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("shows the ntfy server, topic and feed URL with copy buttons", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "iPhone setup");

    await expect(page.getByText("http://127.0.0.1:8799")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy Server" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy Topic" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy Subscription URL" })).toBeVisible();
  });

  test("warns that the topic is the only thing protecting the reminders", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "iPhone setup");
    await expect(page.getByText(/anyone who has it can read them/i)).toBeVisible();
  });

  test("the copy buttons are fully inside the dialog", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "iPhone setup");

    // They were clipped off the right edge before the min-w-0 fix.
    const dialog = await page.getByRole("dialog").boundingBox();
    const button = await page.getByRole("button", { name: "Copy Topic" }).boundingBox();
    expect(button!.x + button!.width).toBeLessThanOrEqual(dialog!.x + dialog!.width);
  });
});

test.describe("notifications dialog", () => {
  test.beforeEach(async ({ api, admin }) => {
    await resetViaApi(admin);
    await clearStub(api);
  });

  test("says when nothing is due", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Notifications");
    await expect(page.getByText("Nothing due in the next 48 hours.")).toBeVisible();
  });

  test("lists a due reminder with Send now and Cancel", async ({ page, api }) => {
    await addReminderViaApi(api, "Dentist", 30);
    await unlock(page);
    await openMenu(page, "Notifications");

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Dentist")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Send now" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("Send now delivers the push and drops the row", async ({ page, api }) => {
    await addReminderViaApi(api, "Dentist", 30);
    await unlock(page);
    await openMenu(page, "Notifications");

    await page.getByRole("dialog").getByRole("button", { name: "Send now" }).click();
    await expect(page.getByText("Nothing due in the next 48 hours.")).toBeVisible();

    const pushes = await stubPushes(api);
    expect(pushes).toHaveLength(1);
    expect(JSON.stringify(pushes[0].body)).toContain("Dentist");
  });

  test("Cancel removes the reminder without sending anything", async ({ page, api }) => {
    const id = await addReminderViaApi(api, "Dentist", 30);
    await unlock(page);
    await openMenu(page, "Notifications");

    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Nothing due in the next 48 hours.")).toBeVisible();

    expect(query(`SELECT * FROM reminders WHERE id = '${id}'`)).toHaveLength(0);
    expect(await stubPushes(api)).toHaveLength(0);
  });

  test("sends an ad-hoc message with the Send button", async ({ page, api }) => {
    await unlock(page);
    await openMenu(page, "Notifications");

    await page.getByPlaceholder("Send a message to ntfy…").fill("From the Send button");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Sent.")).toBeVisible();

    expect(JSON.stringify(await stubPushes(api))).toContain("From the Send button");
  });

  test("Enter in the message box sends it too", async ({ page, api }) => {
    await unlock(page);
    await openMenu(page, "Notifications");

    await page.getByPlaceholder("Send a message to ntfy…").fill("Sent with Enter");
    await page.getByPlaceholder("Send a message to ntfy…").press("Enter");
    await expect(page.getByText("Sent.")).toBeVisible();

    expect(JSON.stringify(await stubPushes(api))).toContain("Sent with Enter");
  });

  test("clears the box after sending", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Notifications");

    const box = page.getByPlaceholder("Send a message to ntfy…");
    await box.fill("anything");
    await box.press("Enter");
    await expect(box).toHaveValue("");
  });
});

test.describe("import dialog", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("stages an .ics file with editable titles", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);
    await openMenu(page, "Import");

    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));

    // Four of the five fixture events are importable; one has no SUMMARY.
    await expect(page.locator('input[aria-label="Event title"]')).toHaveCount(4);
    await expect(page.getByText(/Found 4 events/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("labels a yearly import and previews its next occurrence", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");
    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));

    await expect(page.getByText(/yearly, next \d{4}-03-15/)).toBeVisible();
  });

  test("imports with a renamed title", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");
    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));

    await page.locator('input[aria-label="Event title"]').first().fill("Renamed before import");
    await page.getByRole("button", { name: /^Import \d+ events?$/ }).click();

    await expect(page.getByText(/Imported 4/)).toBeVisible();
    expect(query("SELECT * FROM events WHERE title = 'Renamed before import'")).toHaveLength(1);
  });

  test("lets rows be deselected", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");
    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));

    await page.getByRole("checkbox", { name: /^Import / }).first().uncheck();
    await expect(page.getByText("3 of 4 selected")).toBeVisible();

    await page.getByRole("button", { name: /^Import 3 events$/ }).click();
    await expect(page.getByText(/Imported 3/)).toBeVisible();
  });

  test("select-all toggles every row", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");
    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));

    await page.getByRole("checkbox", { name: "Select all" }).uncheck();
    await expect(page.getByText("0 of 4 selected")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import/ })).toBeDisabled();
  });

  test("recognises a .zip and says what to do about it", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");
    await page.setInputFiles("#i-file", path.join(FIXTURES, "not-really.zip"));

    await expect(page.getByText(/looks like a \.zip archive/i)).toBeVisible();
    await expect(page.locator('input[aria-label="Event title"]')).toHaveCount(0);
  });

  test("reports a file with no events", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");
    await page.setInputFiles("#i-file", path.join(FIXTURES, "garbage.ics"));

    await expect(page.getByText("No events found in that file.")).toBeVisible();
  });

  test("surfaces an error for an unreachable link", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");

    await page.locator("#i-url").fill("https://example.invalid/basic.ics");
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.getByText(/could not|error|failed/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("the imported events then appear on the calendar", async ({ page }) => {
    await unlock(page);
    await openMenu(page, "Import");
    await page.setInputFiles("#i-file", path.join(FIXTURES, "google-export.ics"));
    await page.getByRole("button", { name: /^Import \d+ events?$/ }).click();
    await expect(page.getByText(/Imported 4/)).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    await page.locator("#jump-month").click();
    await page.getByRole("option", { name: "October" }).click();
    await expect(page.getByRole("button", { name: /Team Offsite/ }).first()).toBeVisible();
  });
});

test.describe("theme", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("defaults to dark, matching the big-calendar demo", async ({ page }) => {
    await unlock(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("toggles to light and back, and remembers the choice", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(page.locator("html")).toHaveClass(/light/);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/light/);

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
