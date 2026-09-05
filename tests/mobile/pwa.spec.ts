import { expect, test } from "../support/fixtures";

import { resetViaApi, unlock } from "../support/helpers";

test.describe("home-screen install", () => {
  test("serves a standalone web app manifest", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.name).toBe("Colaco Calendar");
    expect(manifest.short_name).toBe("Colaco");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBeTruthy();
  });

  test("every icon the manifest names actually exists", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} is referenced but not served`).toBe(200);
      expect(response.headers()["content-type"], `${icon.src} is not an image`).toContain("image/");
    }
  });

  test("serves an apple-touch-icon for the iOS home screen", async ({ request }) => {
    // iOS looks for this by convention when no <link> declares one.
    const response = await request.get("/apple-touch-icon.png");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  });

  test("the page links its manifest and sets a theme colour", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  });

  test("declares a viewport that fills the screen", async ({ page }) => {
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");

    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
  });

  test("the lock screen paints to the full dynamic viewport height", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".lock")).toBeVisible();

    // 100dvh matters on iOS, where the toolbar changes the usable height.
    const { lockHeight, viewportHeight } = await page.evaluate(() => ({
      lockHeight: document.querySelector(".lock")!.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
    }));
    expect(lockHeight).toBeGreaterThanOrEqual(viewportHeight - 1);
  });

  test("an unknown path is refused without revealing whether it exists", async ({ request }) => {
    // Static assets are matched first; anything left reaches the Worker, whose
    // session gate answers 401. That is deliberate — a 404 would confirm which
    // paths are real to an unauthenticated caller.
    const response = await request.get("/no-such-page");
    expect([401, 404]).toContain(response.status());
    expect(await response.text()).not.toContain("BEGIN:VCALENDAR");
  });
});

test.describe("touch target sizes", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  test("the bar's controls are tall enough to tap and do not overlap", async ({ page }) => {
    await unlock(page);

    const controls = await page.evaluate(() => {
      const selectors = ["#jump-month", "#jump-week", "#jump-year", 'input[aria-label="Search all events"]'];
      const boxes = selectors.map(selector => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { selector, top: rect.top, left: rect.left, right: rect.right, height: rect.height };
      });

      const today = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Today")!;
      const rect = today.getBoundingClientRect();
      boxes.push({ selector: "Today", top: rect.top, left: rect.left, right: rect.right, height: rect.height });
      return boxes;
    });

    for (const control of controls) {
      expect(control.height, `${control.selector} is only ${control.height}px tall`).toBeGreaterThanOrEqual(36);
    }

    // Controls only need to clear each other within a row — the bar wraps.
    const byRow = new Map<number, typeof controls>();
    for (const control of controls) {
      const row = byRow.get(control.top) ?? [];
      row.push(control);
      byRow.set(control.top, row);
    }

    for (const row of byRow.values()) {
      const ordered = [...row].sort((a, b) => a.left - b.left);
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i].left, `${ordered[i].selector} overlaps ${ordered[i - 1].selector}`).toBeGreaterThanOrEqual(ordered[i - 1].right - 1);
      }
    }
  });

  test("the view switcher buttons are tappable", async ({ page }) => {
    await unlock(page);

    for (const label of ["View by day", "View by month", "View by year"]) {
      const box = (await page.getByRole("link", { name: label }).boundingBox())!;
      expect(box.width, `${label} is too narrow`).toBeGreaterThanOrEqual(32);
      expect(box.height, `${label} is too short`).toBeGreaterThanOrEqual(32);
    }
  });

  test("Add Event is reachable without sideways scrolling", async ({ page }) => {
    await unlock(page);

    const button = page.getByRole("button", { name: "Add Event" });
    await expect(button).toBeVisible();

    const box = (await button.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });
});
