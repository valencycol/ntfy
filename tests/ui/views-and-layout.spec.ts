import { expect, test } from "../support/fixtures";

import { resetViaApi, unlock, watchForErrors } from "../support/helpers";

const VIEWS = [
  { label: "View by day", heading: /Sep \d+, 2026/ },
  { label: "View by week", heading: /Aug 30, 2026 - Sep 5, 2026|Sep \d+, 2026 - Sep \d+, 2026/ },
  { label: "View by month", heading: /Sep 1, 2026 - Sep 30, 2026/ },
  { label: "View by year", heading: /2026/ },
  { label: "View by agenda", heading: /Sep/ },
];

test.describe("the five calendar views", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  for (const view of VIEWS) {
    test(`${view.label} renders without errors`, async ({ page }) => {
      const errors = watchForErrors(page);
      await unlock(page);

      await page.getByRole("link", { name: view.label }).click();
      await expect(page.getByText(view.heading).first()).toBeVisible();
      expect(errors, `${view.label} produced console errors`).toEqual([]);
    });
  }

  test("month view shows the event count and the day-of-week header", async ({ page }) => {
    await unlock(page);

    await expect(page.getByText(/\d+ events?/)).toBeVisible();
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      await expect(page.getByText(day, { exact: true }).first()).toBeVisible();
    }
  });

  test("all-day events read 'All day' instead of a midnight time", async ({ page }) => {
    await unlock(page);

    const holiday = page.getByRole("button", { name: /Public holiday/ }).first();
    await expect(holiday).toContainText("All day");
    await expect(holiday).not.toContainText("12:00 AM");
  });

  test("timed events show their start time", async ({ page }) => {
    await unlock(page);
    await expect(page.getByRole("button", { name: /Standup/ }).first()).toContainText("9:15 AM");
  });

  test("a multi-day event spans its days as one bar", async ({ page }) => {
    await unlock(page);
    // Conference covers 9–11 September but is drawn once as a spanning bar.
    await expect(page.getByRole("button", { name: /Conference/ })).toHaveCount(1);
  });

  test("a single-day all-day event does not become a 24-hour block in day view", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "39");
    await page.keyboard.press("Enter");
    await page.getByRole("link", { name: "View by day" }).click();

    // It belongs in the all-day banner above the grid, not inside it.
    const grid = page.locator("[data-radix-scroll-area-viewport]").first();
    await expect(grid.getByRole("button", { name: /Public holiday/ })).toHaveCount(0);
  });

  test("day view shows the mini calendar and the timeline", async ({ page }) => {
    await unlock(page);
    await page.getByRole("link", { name: "View by day" }).click();

    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.locator("[data-radix-scroll-area-viewport]").first()).toBeVisible();
  });
});

test.describe("layout invariants", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("the page never scrolls horizontally", async ({ page }) => {
    await unlock(page);

    for (const label of ["View by day", "View by week", "View by month", "View by year", "View by agenda"]) {
      await page.getByRole("link", { name: label }).click();
      await page.waitForTimeout(600);
      const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflows, `${label} scrolls horizontally`).toBeFalsy();
    }
  });

  test("day and week views scroll internally, not as a second page scrollbar", async ({ page }) => {
    await unlock(page);

    for (const label of ["View by day", "View by week"]) {
      await page.getByRole("link", { name: label }).click();
      await page.waitForTimeout(800);

      const metrics = await page.evaluate(() => ({
        pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        gridScrolls: (() => {
          const el = document.querySelector("[data-radix-scroll-area-viewport]");
          return el ? el.scrollHeight > el.clientHeight : false;
        })(),
      }));

      // The time grid owns the scrollbar; the page itself must not add one.
      expect(metrics.pageOverflow, `${label} adds a page scrollbar (${metrics.pageOverflow}px)`).toBeLessThanOrEqual(1);
      expect(metrics.gridScrolls, `${label} time grid should scroll internally`).toBeTruthy();
    }
  });

  test("the app bar aligns the title with the search box and jump fields", async ({ page }) => {
    await unlock(page);

    const centres = await page.evaluate(() => {
      const centre = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) : null);
      const title = [...document.querySelectorAll("button")].find(b => b.textContent?.trim().startsWith("Colaco Calendar"));
      const today = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Today");
      return {
        title: centre(title ?? null),
        today: centre(today ?? null),
        search: centre(document.querySelector('input[aria-label="Search all events"]')),
        month: centre(document.querySelector("#jump-month")),
        week: centre(document.querySelector("#jump-week")),
        year: centre(document.querySelector("#jump-year")),
      };
    });

    const values = Object.values(centres) as number[];
    expect(values.every(v => v !== null)).toBeTruthy();
    // All on one visual row, within a couple of pixels.
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(3);
  });

  test("Today comes before the month dropdown", async ({ page }) => {
    await unlock(page);

    const positions = await page.evaluate(() => {
      const today = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Today");
      return {
        today: today!.getBoundingClientRect().left,
        month: document.querySelector("#jump-month")!.getBoundingClientRect().left,
        search: document.querySelector('input[aria-label="Search all events"]')!.getBoundingClientRect().left,
      };
    });

    expect(positions.search).toBeLessThan(positions.today);
    expect(positions.today).toBeLessThan(positions.month);
  });

  test("the settings accordion is gone from the bottom of the page", async ({ page }) => {
    await unlock(page);
    // It lives in a modal now; nothing should sit below the calendar card.
    await expect(page.getByRole("button", { name: /Calendar settings/ })).toHaveCount(0);
  });
});
