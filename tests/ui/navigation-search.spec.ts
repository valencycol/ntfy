import { expect, test } from "../support/fixtures";

import { TEST_SUPERUSER_PHRASE } from "../../playwright.config";

import { resetViaApi, unlock, watchForErrors } from "../support/helpers";

const monthLabel = (page: import("@playwright/test").Page) => page.locator("p, span, div").filter({ hasText: /^\w+ \d{4}$/ }).first();

test.describe("jump controls", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("the month dropdown moves the calendar", async ({ page }) => {
    await unlock(page);

    await page.locator("#jump-month").click();
    await page.getByRole("option", { name: "December" }).click();
    await expect(page.getByText(/Dec 1, 2026 - Dec 31, 2026/)).toBeVisible();
  });

  test("the year box only accepts four digits and strips anything else", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-year", "abc2027xy");
    // The old bug: maxlength truncated before digits were stripped, giving "2".
    await expect(page.locator("#jump-year")).toHaveValue("2027");

    await page.keyboard.press("Enter");
    await expect(page.getByText(/2027/).first()).toBeVisible();
  });

  test("a partial year is ignored until all four digits are typed", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-year", "20");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Sep 1, 2026 - Sep 30, 2026/)).toBeVisible();
  });

  test("the week box jumps to an ISO week", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");
    // Week 44 of 2026 falls in late October.
    await expect(page.getByText(/Oct 1, 2026 - Oct 31, 2026/)).toBeVisible();
    expect(await page.locator("[data-week-highlight]").count()).toBeGreaterThan(0);
  });

  test("the week box rejects a week outside 1-53", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "99");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Sep 1, 2026 - Sep 30, 2026/)).toBeVisible();
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);
  });

  test("Today returns from a distant year", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-year", "2031");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/2031/).first()).toBeVisible();

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText(new RegExp(String(new Date().getFullYear()))).first()).toBeVisible();
  });

  test("the previous and next arrows page one month at a time", async ({ page }) => {
    await unlock(page);
    await expect(page.getByText(/Sep 1, 2026 - Sep 30, 2026/)).toBeVisible();

    await page.getByRole("button", { name: "Next period" }).click();
    await expect(page.getByText(/Oct 1, 2026 - Oct 31, 2026/)).toBeVisible();

    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(page.getByText(/Sep 1, 2026 - Sep 30, 2026/)).toBeVisible();
  });
});

test.describe("search", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  const search = (page: import("@playwright/test").Page) => page.getByLabel("Search all events");
  const results = (page: import("@playwright/test").Page) => page.locator("div.absolute button");

  test("is an always-visible box in the bar, not behind a button", async ({ page }) => {
    await unlock(page);
    await expect(search(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Search$/ })).toHaveCount(0);
  });

  test("finds an event in the month on screen", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);

    await search(page).fill("standup");
    await expect(results(page).first()).toContainText("Standup");
    expect(errors).toEqual([]);
  });

  test("reaches events far outside the loaded window", async ({ page }) => {
    await unlock(page);

    // The anniversary is anchored in 2015 and the birthday in 1968; both are
    // well outside the three-year window the calendar itself fetches.
    await search(page).fill("anniversary");
    await expect(results(page).first()).toContainText("Anniversary");

    await search(page).fill("mum");
    await expect(results(page).first()).toContainText("Mum birthday");
  });

  test("labels a recurring result as yearly and dates it to its next occurrence", async ({ page }) => {
    await unlock(page);

    await search(page).fill("mum birthday");
    const result = results(page).first();
    await expect(result).toContainText("yearly");

    const text = await result.textContent();
    const year = Number(text!.match(/(\d{4})/)![1]);
    expect(year).toBeGreaterThanOrEqual(new Date().getFullYear());
  });

  test("searches notes as well as titles", async ({ page }) => {
    await unlock(page);
    await search(page).fill("daily sync");
    await expect(results(page).first()).toContainText("Standup");
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await unlock(page);
    await search(page).fill("zzzznotanevent");
    await expect(page.getByText("No matches.")).toBeVisible();
  });

  test("jumps the calendar to a chosen result and opens it", async ({ page }) => {
    await unlock(page);

    await search(page).fill("anniversary");
    await results(page).first().click();

    // Navigating without opening it left you hunting for what you just picked.
    await expect(page.getByLabel("Title")).toHaveValue("Anniversary");
    await page.keyboard.press("Escape");

    await expect(page.getByText(/Oct 1, \d{4} - Oct 31, \d{4}/)).toBeVisible();
    await expect(search(page)).toHaveValue("");
  });

  test("Enter moves the calendar to the first match without opening it", async ({ page }) => {
    await unlock(page);

    await search(page).fill("anniversary");
    await expect(results(page).first()).toContainText("Anniversary");
    await search(page).press("Enter");

    await expect(page.getByText(/Oct 1, \d{4} - Oct 31, \d{4}/)).toBeVisible();
    // Jumping is useful; opening an event you only half-typed is not.
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(search(page)).toHaveValue("");
  });

  test("the search Go button does the same as Enter", async ({ page }) => {
    await unlock(page);

    await search(page).fill("anniversary");
    await expect(results(page).first()).toContainText("Anniversary");
    await page.getByRole("button", { name: "Go to the first match" }).click();

    await expect(page.getByText(/Oct 1, \d{4} - Oct 31, \d{4}/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  });

  test("the year Go button jumps the calendar", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-year", "2029");
    await page.getByRole("button", { name: "Go to this year" }).click();
    await expect(page.getByText(/2029/).first()).toBeVisible();
  });

  test("the week Go button jumps and highlights", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "20");
    await page.getByRole("button", { name: "Go to this week" }).click();
    expect(await page.locator("[data-week-highlight]").count()).toBeGreaterThan(0);
  });

  test("Enter still runs a superuser command", async ({ page }) => {
    await unlock(page);

    await search(page).fill("enter superuser");
    await search(page).press("Enter");
    await expect(page.getByRole("heading", { name: "Enable superuser" })).toBeVisible();
  });

  test("clears with the clear button and with Escape", async ({ page }) => {
    await unlock(page);

    await search(page).fill("standup");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search(page)).toHaveValue("");

    await search(page).fill("standup");
    await search(page).press("Escape");
    await expect(search(page)).toHaveValue("");
  });

  test("closes its results when clicking elsewhere", async ({ page }) => {
    await unlock(page);

    await search(page).fill("standup");
    await expect(results(page).first()).toBeVisible();

    await page.getByText(/Sep 1, 2026/).click();
    await expect(results(page)).toHaveCount(0);
  });

  test("has only one clear affordance, not the browser's as well", async ({ page }) => {
    await unlock(page);
    await expect(search(page)).toHaveAttribute("type", "text");

    await search(page).fill("a");
    await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(1);
  });
});
