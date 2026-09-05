import { expect, test } from "../support/fixtures";

import { clearLoginFailures, resetViaApi, tapPattern, unlock, watchForErrors } from "../support/helpers";

test.describe("lock screen on a phone", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));
  // A wrong pattern here must not count towards a lockout that would break
  // every later spec, so each test ends by clearing the counter.
  test.afterEach(async ({ api }) => clearLoginFailures(api));

  test("fits the viewport with no scrolling in either direction", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/");
    await expect(page.locator(".lock")).toBeVisible();

    const metrics = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      cardWidth: document.querySelector(".lockcard")!.getBoundingClientRect().width,
      viewport: document.documentElement.clientWidth,
    }));

    expect(metrics.horizontal).toBeLessThanOrEqual(1);
    expect(metrics.vertical).toBeLessThanOrEqual(1);
    // The glass card is width-capped but must not touch the screen edges.
    expect(metrics.cardWidth).toBeLessThan(metrics.viewport);
    expect(errors).toEqual([]);
  });

  test("the whole 3x3 pad is on screen", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".dot");

    const viewport = page.viewportSize()!;
    for (let i = 0; i < 9; i++) {
      const box = (await page.locator(".dot").nth(i).boundingBox())!;
      expect(box.x, `dot ${i} is off the left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `dot ${i} is off the right edge`).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height, `dot ${i} is below the fold`).toBeLessThanOrEqual(viewport.height);
    }
  });

  test("each dot is a comfortable touch target", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".dot");

    // Apple's guidance is 44pt; the pad uses 72px cells so the whole cell is
    // tappable even though the drawn dot is small.
    for (let i = 0; i < 9; i++) {
      const box = (await page.locator(".dot").nth(i).boundingBox())!;
      expect(box.width, `dot ${i} is too narrow to tap`).toBeGreaterThanOrEqual(44);
      expect(box.height, `dot ${i} is too short to tap`).toBeGreaterThanOrEqual(44);
    }
  });

  test("tapping the dots one at a time unlocks", async ({ page }) => {
    // This is the path a finger takes when tapping rather than dragging, and
    // the one keyboard and switch users rely on. It auto-submits on a pause.
    await unlock(page);
    await expect(page.getByRole("button", { name: "Add Event" })).toBeVisible();
  });

  test("a wrong pattern shows the rose state and stays locked", async ({ page }) => {
    await page.goto("/");
    await tapPattern(page, [0, 1, 2, 5]);

    await expect(page.locator(".lockmsg")).toHaveText(/not right/i, { timeout: 15_000 });
    await expect(page.locator(".lock.wrong")).toBeVisible();
    await expect(page.locator(".lock")).toBeVisible();
  });

  test("survives a rotation to landscape", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".lock")).toBeVisible();

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".lockcard")).toBeVisible();

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflows).toBeFalsy();
  });
});
