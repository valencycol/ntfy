import { expect, test } from "../support/fixtures";

import { BASE_URL, TEST_SUPERUSER_PHRASE } from "../../playwright.config";
import { fixtureId, query, resetViaApi, sql } from "../support/helpers";

test.describe("superuser capability", () => {
  test.beforeEach(async ({ admin }) => {
    await resetViaApi(admin);
    sql("DELETE FROM auth_attempts");
  });

  test("a session alone cannot delete an event", async ({ api }) => {
    const id = fixtureId("Standup");

    const response = await api.delete(`/api/events/${id}`);
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toMatch(/switched off/i);

    // The event is untouched — the guard is real, not cosmetic.
    expect(query(`SELECT * FROM events WHERE id = '${id}'`)).toHaveLength(1);
  });

  test("reports whether the capability is held", async ({ api, admin }) => {
    // `api` holds a session only; `admin` also carries the capability cookie.
    expect((await (await api.get("/api/superuser")).json()).enabled).toBe(false);
    expect((await (await admin.get("/api/superuser")).json()).enabled).toBe(true);
  });

  test("the right phrase issues a locked-down capability cookie", async ({ api }) => {
    const granted = await api.post("/api/superuser", { data: { phrase: TEST_SUPERUSER_PHRASE } });
    expect(granted.status(), await granted.text()).toBe(200);

    const cookie = granted.headers()["set-cookie"] ?? "";
    expect(cookie).toContain("su=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    // Short-lived, so a forgotten "enable" does not stay dangerous.
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  test("holding the capability makes deleting work", async ({ admin }) => {
    const id = fixtureId("Standup");
    expect((await admin.delete(`/api/events/${id}`)).status()).toBe(200);
    expect(query(`SELECT * FROM events WHERE id = '${id}'`)).toHaveLength(0);
  });

  test("a wrong phrase grants nothing", async ({ api }) => {
    const response = await api.post("/api/superuser", { data: { phrase: "not the phrase" } });
    expect(response.status()).toBe(401);
    expect(response.headers()["set-cookie"] ?? "").not.toContain("su=");

    expect((await api.delete(`/api/events/${fixtureId("Standup")}`)).status()).toBe(403);
  });

  test("disabling revokes it", async ({ api }) => {
    await api.post("/api/superuser", { data: { phrase: TEST_SUPERUSER_PHRASE } });
    expect((await api.get("/api/superuser")).ok()).toBeTruthy();

    const off = await api.delete("/api/superuser");
    expect(off.headers()["set-cookie"]).toContain("Max-Age=0");
  });

  test("a forged capability cookie is refused", async ({ playwright }) => {
    const context = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { cookie: `su=${Math.floor(Date.now() / 1000) + 3600}.forgedsignature` },
    });
    // No session either, so this is 401; the point is it is never 200.
    expect((await context.delete("/api/events/11111111-1111-4111-8111-111111111111")).status()).not.toBe(200);
    await context.dispose();
  });

  test("the phrase never appears in anything the browser is served", async ({ request }) => {
    const shell = await (await request.get("/")).text();
    const scripts = [...shell.matchAll(/\/_next\/static\/[^"']+\.js/g)].map(m => m[0]);
    expect(scripts.length).toBeGreaterThan(0);

    for (const src of scripts) {
      const body = await (await request.get(src)).text();
      expect(body, `${src} leaks the superuser phrase`).not.toContain(TEST_SUPERUSER_PHRASE);
    }
  });
});

test.describe("renaming is protected too", () => {
  test.beforeEach(async ({ admin }) => {
    await resetViaApi(admin);
    sql("DELETE FROM auth_attempts");
  });

  const payloadFor = (title: string) => ({
    title,
    notes: "Daily sync",
    start_date: "2026-09-04",
    end_date: "2026-09-04",
    start_time: "09:15",
    end_time: "09:30",
    all_day: 0,
    color: "#2563eb",
    repeat_yearly: 0,
    reminder_times: ["09:00"],
  });

  test("a session alone cannot rename an event", async ({ api }) => {
    const id = fixtureId("Standup");

    const response = await api.patch(`/api/events/${id}`, { data: payloadFor("Sneakily renamed") });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toMatch(/renaming/i);

    expect(query<{ title: string }>(`SELECT title FROM events WHERE id = '${id}'`)[0].title).toBe("Standup");
  });

  test("everything else about an event stays editable without it", async ({ api }) => {
    const id = fixtureId("Standup");

    // Same title, different time and colour — allowed.
    const response = await api.patch(`/api/events/${id}`, {
      data: { ...payloadFor("Standup"), start_time: "10:00", end_time: "10:45", color: "#16a34a" },
    });
    expect(response.status(), await response.text()).toBe(200);

    const [row] = query<{ start_time: string; color: string }>(`SELECT start_time, color FROM events WHERE id = '${id}'`);
    expect(row.start_time).toBe("10:00");
    expect(row.color).toBe("#16a34a");
  });

  test("with the capability the rename goes through", async ({ admin }) => {
    const id = fixtureId("Standup");

    expect((await admin.patch(`/api/events/${id}`, { data: payloadFor("Properly renamed") })).status()).toBe(200);
    expect(query<{ title: string }>(`SELECT title FROM events WHERE id = '${id}'`)[0].title).toBe("Properly renamed");
  });

  test("creating a new event with any name is always allowed", async ({ api }) => {
    // The lock is on changing an existing name, not on naming something new.
    const response = await api.post("/api/events", { data: payloadFor("Brand new event") });
    expect(response.status(), await response.text()).toBe(200);
  });
});
