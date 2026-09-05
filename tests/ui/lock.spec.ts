import { expect, test } from "../support/fixtures";

import { TEST_PATTERN } from "../../playwright.config";
import { drawPattern, clearLoginFailures, resetViaApi, unlock, watchForErrors } from "../support/helpers";

test.describe("the lock screen", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));
  // Wrong-pattern tests leave failure counters behind.
  // A wrong pattern here must not count towards a lockout that would break
  // every later spec, so each test ends by clearing the counter.
  test.afterEach(async ({ api }) => clearLoginFailures(api));

  test("is what an unauthenticated visitor sees", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/");

    await expect(page.locator(".lock")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Colaco Calendar" })).toBeVisible();
    await expect(page.locator(".dot")).toHaveCount(9);

    // No calendar content leaks before unlocking.
    await expect(page.getByRole("button", { name: "Add Event" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("has no Clear or Unlock buttons — releasing the drag submits", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^(Clear|Unlock|Submit)$/ })).toHaveCount(0);
  });

  test("lights each dot as it is crossed and draws a trail", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".dot");

    const centres = [];
    for (const index of TEST_PATTERN) {
      const box = await page.locator(".dot").nth(index).boundingBox();
      centres.push({ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
    }

    await page.mouse.move(centres[0].x, centres[0].y);
    await page.mouse.down();
    for (const point of centres.slice(1)) await page.mouse.move(point.x, point.y, { steps: 6 });

    await expect(page.locator('.dot[aria-pressed="true"]')).toHaveCount(TEST_PATTERN.length);
    const points = await page.locator(".trail polyline").getAttribute("points");
    expect(points!.split(" ")).toHaveLength(TEST_PATTERN.length);

    await page.mouse.up();
    await expect(page.locator(".lock")).toHaveCount(0);
  });

  test("a slow drag is not submitted part-way through", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".dot");

    const centres = [];
    for (const index of TEST_PATTERN) {
      const box = await page.locator(".dot").nth(index).boundingBox();
      centres.push({ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
    }

    // Draw the first four dots, then hesitate with the finger still down —
    // this used to submit those four and come back "not right".
    await page.mouse.move(centres[0].x, centres[0].y);
    await page.mouse.down();
    for (const point of centres.slice(1, 4)) await page.mouse.move(point.x, point.y, { steps: 6 });
    await expect(page.locator('.dot[aria-pressed="true"]')).toHaveCount(4);

    await page.waitForTimeout(3000);
    await expect(page.locator(".lockmsg"), "it must wait for the finger to lift").toHaveText("");
    await expect(page.locator(".lock.wrong")).toHaveCount(0);

    // Finishing the pattern still works after the pause.
    await page.mouse.move(centres[4].x, centres[4].y, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator(".lock")).toHaveCount(0, { timeout: 15_000 });
  });

  test("tapping dot by dot tolerates a slow hand", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".dot");

    // A deliberate tapper pausing between dots must not be cut off either.
    for (const index of TEST_PATTERN.slice(0, 4)) {
      await page.locator(".dot").nth(index).click();
      await page.waitForTimeout(600);
    }
    await expect(page.locator(".lockmsg")).toHaveText("");

    await page.locator(".dot").nth(TEST_PATTERN[4]).click();
    await expect(page.locator(".lock")).toHaveCount(0, { timeout: 15_000 });
  });

  test("shows the wrong-pattern state and stays locked", async ({ page }) => {
    await page.goto("/");
    await drawPattern(page, [0, 1, 2, 5, 8]);

    await expect(page.locator(".lockmsg")).toHaveText(/not right/i);
    await expect(page.locator(".lock.wrong")).toBeVisible();
    await expect(page.locator(".lock")).toBeVisible();

    // The attempt clears itself so a retry starts clean.
    await expect(page.locator('.dot[aria-pressed="true"]')).toHaveCount(0, { timeout: 5000 });
  });

  test("ignores a pattern shorter than four dots", async ({ page }) => {
    await page.goto("/");
    await drawPattern(page, [0, 1]);
    await page.waitForTimeout(1500);

    // Too short to submit at all: still locked, and no error shown.
    await expect(page.locator(".lock")).toBeVisible();
    await expect(page.locator(".lockmsg")).toHaveText("");
  });

  test("the correct pattern reveals a populated calendar", async ({ page }) => {
    const errors = watchForErrors(page);
    await unlock(page);

    await expect(page.getByRole("button", { name: /Standup/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a session survives a reload without re-drawing the pattern", async ({ page }) => {
    await unlock(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".lock")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Add Event" })).toBeVisible();
  });

  test("keeps its own emerald styling rather than following the app theme", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".lock")).toBeVisible();

    // The emerald/gold treatment is deliberate and independent of light/dark.
    const background = await page.locator(".lock").evaluate(el => getComputedStyle(el).backgroundImage);
    expect(background).toContain("gradient");
    expect(background, "the deep emerald stop should be present").toContain("rgb(11, 59, 46)");
  });

  test("the pattern dots stay legible against the glass card", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".dot");

    // Gold outlines on a pale card only reached 1.96:1; a control outline
    // wants at least 3:1, so this guards the darker ring from being reverted.
    const contrast = await page.locator(".dot").first().evaluate(el => {
      const luminance = (rgb: string) => {
        const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
        const channel = (c: number) => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };

      const ring = luminance(getComputedStyle(el, "::after").borderTopColor);
      const card = luminance(getComputedStyle(document.querySelector(".lockcard")!).backgroundColor.replace(/[\d.]+\)$/, "1)"));
      const [hi, lo] = [ring, card].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    });

    expect(contrast).toBeGreaterThanOrEqual(3);
  });
});
