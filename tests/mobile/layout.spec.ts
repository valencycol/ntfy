import { expect, test } from "../support/fixtures";

import { resetViaApi, unlock, watchForErrors } from "../support/helpers";

test.describe("phone layout", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("unlocks and shows the calendar", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);
    await expect(page.getByRole("button", { name: /Colaco Calendar/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("stacks the bar: title, then search, then Today with the jump fields", async ({ page }) => {
    await unlock(page);

    const rows = await page.evaluate(() => {
      const centre = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) : null);
      const title = [...document.querySelectorAll("button")].find(b => b.textContent?.trim().startsWith("Colaco Calendar"));
      const today = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Today");
      return {
        title: centre(title ?? null)!,
        search: centre(document.querySelector('input[aria-label="Search all events"]'))!,
        today: centre(today ?? null)!,
        month: centre(document.querySelector("#jump-month"))!,
        week: centre(document.querySelector("#jump-week"))!,
        year: centre(document.querySelector("#jump-year"))!,
        todayLeft: (today as HTMLElement).getBoundingClientRect().left,
        monthLeft: document.querySelector("#jump-month")!.getBoundingClientRect().left,
      };
    });

    // Title, then the search box, then the jump controls beneath it.
    expect(rows.title).toBeLessThan(rows.search);
    expect(rows.search).toBeLessThan(rows.today);

    // With a Go button on each field there is no longer room for one row on a
    // phone, so they wrap — but never onto more than two, and in reading order.
    const controlRows = new Set([rows.today, rows.month, rows.week, rows.year]);
    expect(controlRows.size).toBeLessThanOrEqual(2);
    expect(rows.today).toBeLessThanOrEqual(rows.week);
    expect(rows.todayLeft).toBeLessThan(rows.monthLeft);
  });

  test("never scrolls horizontally", async ({ page }) => {
    await unlock(page);
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows).toBeFalsy();
  });

  test("the year field shows all four digits without clipping", async ({ page }) => {
    await unlock(page);

    const clipped = await page.evaluate(() => {
      const el = document.querySelector("#jump-year") as HTMLInputElement;
      return el.scrollWidth > el.clientWidth + 1;
    });
    expect(clipped, "the year field is clipping its value").toBeFalsy();
  });

  test("the search box spans the full width of its row", async ({ page }) => {
    await unlock(page);

    const ratio = await page.evaluate(() => {
      const el = document.querySelector('input[aria-label="Search all events"]')!;
      return el.getBoundingClientRect().width / document.documentElement.clientWidth;
    });
    // It shares the row with its Go button, so not quite the full width.
    expect(ratio).toBeGreaterThan(0.75);
  });

  test("the menu opens and its dialogs fit the screen", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Colaco Calendar/ }).click();
    await page.getByRole("button", { name: "Notifications", exact: true }).click();

    const dialog = await page.getByRole("dialog").boundingBox();
    const viewport = page.viewportSize()!;
    expect(dialog!.width).toBeLessThanOrEqual(viewport.width);
    expect(dialog!.x).toBeGreaterThanOrEqual(0);
  });

  test("the event editor is reachable and scrolls inside the dialog", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "Add Event" }).click();

    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
    // The tall form must scroll within the dialog, not stretch the page.
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows).toBeFalsy();
  });

  test("week view explains that it needs a wider screen", async ({ page }) => {
    await unlock(page);
    await page.getByRole("link", { name: "View by week" }).click();
    await expect(page.getByText(/not available on smaller devices/i)).toBeVisible();
  });

  test("day view works on a phone", async ({ page }) => {
    await unlock(page);
    await page.getByRole("link", { name: "View by day" }).click();
    await expect(page.locator("[data-radix-scroll-area-viewport]").first()).toBeVisible();
  });
});
