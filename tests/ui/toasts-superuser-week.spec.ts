import { expect, test } from "../support/fixtures";

import { TEST_SUPERUSER_PHRASE } from "../../playwright.config";

import { enableSuperuser, query, resetViaApi, unlock, watchForErrors } from "../support/helpers";

const search = (page: import("@playwright/test").Page) => page.getByLabel("Search all events");

test.describe("toasts for invalid entries", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("a week number outside 1-53 is rejected with a toast", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "99");
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-toast="error"]')).toContainText("Week 99 is not a week");
    // The calendar must not have moved, and nothing gets outlined.
    await expect(page.getByText(/Sep 1, 2026 - Sep 30, 2026/)).toBeVisible();
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);
    await expect(page.locator("#jump-week")).toHaveValue("");
  });

  test("a half-typed year is rejected with a toast", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-year", "20");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-toast="error"]')).toContainText("not a year");
  });

  test("a year outside the supported range is rejected", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-year", "1200");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-toast="error"]')).toContainText(/outside the range/);
  });

  test("a valid week and year produce no toast", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);

    await page.fill("#jump-week", "12");
    await page.keyboard.press("Enter");
    await page.fill("#jump-year", "2027");
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-toast="error"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a toast can be dismissed by hand", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "0");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-toast="error"]')).toBeVisible();

    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await expect(page.locator('[data-toast="error"]')).toHaveCount(0);
  });
});

test.describe("week highlight", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("entering a week number outlines that whole week", async ({ page }) => {
    await unlock(page);
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");

    // Every rendered day of that ISO week picks up the outline.
    const highlighted = page.locator("[data-week-highlight]");
    expect(await highlighted.count()).toBeGreaterThan(4);
  });

  test("a clear button appears and removes the outline", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");

    // The week's Go button becomes Clear once a week is outlined.
    const clear = page.getByRole("button", { name: /Clear the week 44 highlight/ });
    await expect(clear).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to this week" })).toHaveCount(0);

    await clear.click();
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);
    await expect(clear).toHaveCount(0);
    await expect(page.locator('[data-toast]').filter({ hasText: /highlight cleared/ })).toBeVisible();
  });

  test("changing the year clears the highlight and its button", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");
    expect(await page.locator("[data-week-highlight]").count()).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /Clear the week 44/ })).toBeVisible();

    await page.fill("#jump-year", "2029");
    await page.keyboard.press("Enter");

    // The outline is off screen, so the button that clears it must go too.
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Clear the week/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Go to this week" })).toBeVisible();
  });

  test("changing the month clears it too", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Clear the week 44/ })).toBeVisible();

    await page.locator("#jump-month").click();
    await page.getByRole("option", { name: "February" }).click();

    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Clear the week/ })).toHaveCount(0);
  });

  test("Today clears it as well", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Clear the week 44/ })).toBeVisible();

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("button", { name: /Clear the week/ })).toHaveCount(0);
  });

  test("the arrows clear it when they page away", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Clear the week 44/ })).toBeVisible();

    await page.getByRole("button", { name: "Next period" }).click();
    await expect(page.getByRole("button", { name: /Clear the week/ })).toHaveCount(0);
  });

  test("re-entering the same week keeps it highlighted", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");
    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");

    expect(await page.locator("[data-week-highlight]").count()).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /Clear the week 44/ })).toBeVisible();
  });

  test("no clear button is shown when no week is highlighted", async ({ page }) => {
    await unlock(page);
    await expect(page.getByRole("button", { name: /Clear the week/ })).toHaveCount(0);
  });

  test("an invalid week is refused and leaves nothing outlined", async ({ page }) => {
    await unlock(page);

    await page.fill("#jump-week", "44");
    await page.keyboard.press("Enter");
    expect(await page.locator("[data-week-highlight]").count()).toBeGreaterThan(0);

    // Typing clears the previous outline, and an invalid week adds no new one.
    await page.fill("#jump-week", "88");
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(page.locator('[data-toast="error"]')).toBeVisible();
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);
    await expect(page.getByText(/Oct 1, 2026 - Oct 31, 2026/)).toBeVisible();
  });
});

test.describe("superuser gate on deleting", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("deleting is off by default", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Standup/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();

    const del = page.getByRole("button", { name: "Delete" });
    await expect(del).toBeDisabled();
    await expect(del).toHaveAttribute("title", /enable superuser/i);
  });

  test("the passphrase switches it on and the command switches it back off", async ({ page }) => {
    await unlock(page);
    await enableSuperuser(page);

    await page.getByRole("button", { name: /Standup/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Delete" })).toBeEnabled();
    await page.keyboard.press("Escape");

    await search(page).fill("disable superuser");
    await search(page).press("Enter");
    await expect(page.locator('[data-toast]').filter({ hasText: /Superuser disabled/ })).toBeVisible();

    await page.getByRole("button", { name: /Standup/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  test("a wrong passphrase is refused and does not enable anything", async ({ page }) => {
    await unlock(page);

    await search(page).fill("enter superuser");
    await search(page).press("Enter");
    await page.getByLabel("Passphrase").fill("hunter2");
    await page.getByRole("button", { name: "Confirm" }).click();

    // The prompt stays open with an error rather than silently failing.
    await expect(page.getByText(/not right/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: /Standup/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  test("the passphrase is typed into a masked field, not the search box", async ({ page }) => {
    await unlock(page);

    await search(page).fill("enter superuser");
    await search(page).press("Enter");

    // Typing it in the open would leave it on screen and offer it to autofill.
    await expect(page.getByLabel("Passphrase")).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Passphrase")).toHaveAttribute("autocomplete", "off");
    await expect(search(page)).toHaveValue("");
  });

  test("the prompt keeps nothing behind after it is closed", async ({ page }) => {
    await unlock(page);

    await search(page).fill("enter superuser");
    await search(page).press("Enter");
    await page.getByLabel("Passphrase").fill("something-wrong");
    await page.getByRole("button", { name: "Cancel" }).click();

    await search(page).fill("enter superuser");
    await search(page).press("Enter");
    await expect(page.getByLabel("Passphrase")).toHaveValue("");
  });

  test("the commands are never treated as a search", async ({ page }) => {
    await unlock(page);

    await search(page).fill("enter superuser");
    // No results panel, so the command is never treated as a search.
    await expect(page.locator("div.absolute button")).toHaveCount(0);
    await search(page).press("Enter");
    await expect(search(page)).toHaveValue("");
  });

  test("the placeholder reads as superuser when it is on", async ({ page }) => {
    await unlock(page);
    await enableSuperuser(page);
    await expect(search(page)).toHaveAttribute("placeholder", "Search Events as Superuser");
  });

  test("an event actually survives a delete attempt while off", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Standup/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Delete" }).click({ force: true }).catch(() => {});

    await page.keyboard.press("Escape");
    expect(query("SELECT * FROM events WHERE title = 'Standup'")).toHaveLength(1);
  });
});

test.describe("a day's events as a list", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("the tile count opens the day's events", async ({ page }) => {
    await unlock(page);

    await page.locator('button[aria-label*="open the list"]').first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.locator("li button").count()).toBeGreaterThan(0);
  });

  test("picking one hands over to the editor", async ({ page }) => {
    await unlock(page);

    await page.locator('button[aria-label*="open the list"]').first().click();
    await page.getByRole("dialog").locator("li button").first().click();

    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("clicking a tile opens the list on a wide screen too", async ({ page }) => {
    await unlock(page);

    // A month cell only ever draws three events, so on a wide screen the rest
    // were unreachable without this.
    await page.getByRole("button", { name: /on 4 September 2026/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("li button")).toHaveCount(3);
  });

  test("clicking an event badge opens that event, not the day list", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Standup/ }).first().click();
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("dialog").locator("li button")).toHaveCount(0);
  });

  test("double clicking a tile opens a blank editor dated to that day", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /on 4 September 2026/ }).dblclick();
    // Whichever way the single-click timer races, the day list must not be
    // what is left on screen.
    await expect(page.getByRole("heading", { name: /September 2026$/ })).toHaveCount(0);

    // The create form, not the day's list and not an existing event.
    await expect(page.getByRole("heading", { name: "Add event" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
    await expect(page.getByText("September 4th, 2026").first()).toBeVisible();
  });

  test("an empty day opens a blank editor rather than an empty list", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "14", exact: true }).first().click();

    await expect(page.getByRole("heading", { name: "Add event" })).toBeVisible();
    await expect(page.getByText("September 14th, 2026").first()).toBeVisible();
  });

  test("no tile navigates away to the day view", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: "4", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Still on the month view behind the modal.
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("a single click still opens the list rather than the editor", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /on 4 September 2026/ }).click();
    await expect(page.getByRole("dialog").locator("li button")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
  });

  test("the day list can start a new event on that day", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /on 4 September 2026/ }).click();
    await page.getByRole("button", { name: /Add an event on this day/ }).click();

    await expect(page.getByRole("heading", { name: "Add event" })).toBeVisible();
    await expect(page.getByText("September 4th, 2026").first()).toBeVisible();
  });

  test("the count matches the events on that day", async ({ page }) => {
    await unlock(page);

    // 4 September carries Standup, Dentist and Late meeting.
    const badge = page.getByRole("button", { name: /on 4 September 2026/ });
    await expect(badge).toHaveText("3");

    await badge.click();
    await expect(page.getByRole("dialog").locator("li button")).toHaveCount(3);
  });
});

test.describe("long notes", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  const openLongNote = async (page: import("@playwright/test").Page) => {
    await page.fill("#jump-month", "").catch(() => {});
    await page.locator("#jump-month").click();
    await page.getByRole("option", { name: "September" }).click();
    await page.getByRole("button", { name: /Long note meeting/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  };

  test("a long note is cut off with a clickable ellipsis", async ({ page }) => {
    await unlock(page);
    await openLongNote(page);

    const shown = await page.getByRole("dialog").getByText(/^Agenda:/).textContent();
    // Roughly the preview, not the whole 850-character note.
    expect(shown!.length).toBeLessThan(400);
    expect(shown).not.toContain("END-OF-NOTE");

    await expect(page.getByRole("button", { name: "Read the whole note" })).toBeVisible();
  });

  test("clicking it opens the whole note in its own modal", async ({ page }) => {
    await unlock(page);
    await openLongNote(page);

    await page.getByRole("button", { name: "Read the whole note" }).click();

    const full = page.getByRole("dialog").filter({ hasText: "Long note meeting" }).last();
    await expect(full.getByText(/END-OF-NOTE/)).toBeVisible();
  });

  test("a short note is shown in full with no ellipsis", async ({ page }) => {
    await unlock(page);

    await page.getByRole("button", { name: /Standup/ }).first().click();
    await expect(page.getByRole("dialog").getByText("Daily sync")).toBeVisible();
    await expect(page.getByRole("button", { name: "Read the whole note" })).toHaveCount(0);
  });
});

test.describe("weeks that do not exist", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  const goToYear = async (page: import("@playwright/test").Page, year: string) => {
    await page.fill("#jump-year", year);
    await page.keyboard.press("Enter");
    await expect(page.getByText(new RegExp(year)).first()).toBeVisible();
  };

  test("week 53 is refused in a year that has only 52", async ({ page }) => {
    await unlock(page);
    await goToYear(page, "2027"); // 52 ISO weeks

    await page.fill("#jump-week", "53");
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-toast="error"]')).toContainText("2027 has only 52 weeks");
    // It must not silently land on week 1 of the following year.
    await expect(page.locator("[data-week-highlight]")).toHaveCount(0);
    await expect(page.getByText(/2027/).first()).toBeVisible();
  });

  test("week 53 is accepted in a year that has one", async ({ page }) => {
    await unlock(page);
    await goToYear(page, "2026"); // 53 ISO weeks

    await page.fill("#jump-week", "53");
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-toast="error"]')).toHaveCount(0);
    expect(await page.locator("[data-week-highlight]").count()).toBeGreaterThan(0);
  });

  test("week 52 still works in a 52-week year", async ({ page }) => {
    await unlock(page);
    await goToYear(page, "2027");

    await page.fill("#jump-week", "52");
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-toast="error"]')).toHaveCount(0);
    expect(await page.locator("[data-week-highlight]").count()).toBeGreaterThan(0);
  });
});
