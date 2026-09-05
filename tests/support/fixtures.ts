import { test as base, expect } from "@playwright/test";

import { BASE_URL, TEST_PATTERN, TEST_SUPERUSER_PHRASE } from "../../playwright.config";
import { sql } from "./helpers";

import type { APIRequestContext } from "@playwright/test";

interface IFixtures {
  /** A valid session, and nothing more — deleting is refused. */
  api: APIRequestContext;
  /** A session plus the superuser capability, for setup that deletes. */
  admin: APIRequestContext;
}

export const test = base.extend<IFixtures>({
  api: async ({ playwright }, use) => {
    // The session cookie is issued `Secure`, which is right in production but
    // means an http:// request context refuses to store it. Rather than
    // weakening the cookie for tests, log in once and replay the value as an
    // explicit header.
    const bootstrap = await playwright.request.newContext({ baseURL: BASE_URL });
    const attempt = () => bootstrap.post("/api/login", { data: { pattern: TEST_PATTERN.join("") } });

    let response = await attempt();
    if (response.status() === 429) {
      // The throttling spec locks this IP out for 15 minutes, and fixtures are
      // built before beforeEach hooks get a chance to clear it. Rather than
      // making every spec depend on running order, undo the lockout here.
      sql("DELETE FROM auth_attempts");
      response = await attempt();
    }
    expect(response.status(), `login failed: ${await response.text()}`).toBe(200);

    const sid = (response.headers()["set-cookie"] ?? "").match(/sid=([^;]+)/)?.[1];
    await bootstrap.dispose();
    expect(sid, "login did not return a sid cookie").toBeTruthy();

    const context = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: `sid=${sid}` } });
    await use(context);
    await context.dispose();
  },

  admin: async ({ playwright }, use) => {
    // Self-contained: both the session and the capability cookies are issued
    // `Secure`, which an http:// context refuses to store, so each is captured
    // from its response and replayed as a header.
    const bootstrap = await playwright.request.newContext({ baseURL: BASE_URL });

    const login = await bootstrap.post("/api/login", { data: { pattern: TEST_PATTERN.join("") } });
    expect(login.status(), `admin login failed: ${await login.text()}`).toBe(200);
    const sid = (login.headers()["set-cookie"] ?? "").match(/sid=([^;]+)/)?.[1];
    expect(sid, "admin login returned no session cookie").toBeTruthy();

    const withSession = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: `sid=${sid}` } });
    const granted = await withSession.post("/api/superuser", { data: { phrase: TEST_SUPERUSER_PHRASE } });
    expect(granted.status(), `could not take the superuser capability: ${await granted.text()}`).toBe(200);
    const su = (granted.headers()["set-cookie"] ?? "").match(/su=([^;]+)/)?.[1];
    expect(su, "granting superuser returned no capability cookie").toBeTruthy();

    await bootstrap.dispose();
    await withSession.dispose();

    const context = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: `sid=${sid}; su=${su}` } });
    await use(context);
    await context.dispose();
  },
});

export { expect };
