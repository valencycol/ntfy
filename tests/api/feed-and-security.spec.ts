import { expect, test } from "../support/fixtures";

import { fixtureId, resetViaApi } from "../support/helpers";

test.describe("the read-only .ics feed", () => {
  test.beforeEach(async ({ admin }) => resetViaApi(admin));

  const feedUrl = async (api: import("@playwright/test").APIRequestContext) => {
    const response = await api.get("/api/feed-url");
    expect(response.status()).toBe(200);
    return new URL((await response.json()).url).pathname;
  };

  test("serves valid iCalendar at the tokenised URL", async ({ api }) => {
    const response = await api.get(await feedUrl(api));
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/calendar");

    const body = await response.text();
    expect(body.startsWith("BEGIN:VCALENDAR")).toBeTruthy();
    expect(body.trimEnd().endsWith("END:VCALENDAR")).toBeTruthy();
    expect(body).toContain("VERSION:2.0");
    expect(body).toContain("SUMMARY:Standup");
    expect(body).toContain("SUMMARY:Conference");

    // Balanced blocks — a truncated feed silently breaks iOS subscriptions.
    expect((body.match(/BEGIN:VEVENT/g) ?? []).length).toBe((body.match(/END:VEVENT/g) ?? []).length);
  });

  test("encodes all-day events as VALUE=DATE and timed ones with a clock time", async ({ api }) => {
    const body = await (await api.get(await feedUrl(api))).text();
    expect(body).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
    expect(body).toMatch(/DTSTART(;TZID=[^:]+)?:\d{8}T\d{6}/);
  });

  test("delegates yearly recurrence to the client with an RRULE", async ({ api }) => {
    const body = await (await api.get(await feedUrl(api))).text();

    // The anchor date plus FREQ=YEARLY is the correct iCalendar encoding — the
    // subscribing client expands it, so it must not be expanded server-side.
    const block = body.split("BEGIN:VEVENT").find(b => b.includes("SUMMARY:Mum birthday"));
    expect(block, "the birthday should be in the feed").toBeTruthy();
    expect(block).toContain("DTSTART;VALUE=DATE:19680907");
    expect(block).toContain("RRULE:FREQ=YEARLY");

    // A non-recurring event must not pick up an RRULE.
    const standup = body.split("BEGIN:VEVENT").find(b => b.includes("SUMMARY:Standup"));
    expect(standup).not.toContain("RRULE");
  });

  test("is unreachable without the token", async ({ request }) => {
    for (const path of ["/feed/.ics", "/feed/wrong-token.ics", "/feed//.ics"]) {
      const response = await request.get(path);
      expect(response.status(), `${path} should not serve the calendar`).not.toBe(200);
    }
  });

  test("needs no session, since iOS Calendar cannot log in", async ({ api, request }) => {
    const path = await feedUrl(api);
    // `request` carries no session cookie at all.
    const response = await request.get(path);
    expect(response.status()).toBe(200);
  });

  test("asks not to be indexed and not to be cached", async ({ api }) => {
    const response = await api.get(await feedUrl(api));
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("security headers", () => {
  test("the app shell carries a restrictive CSP and framing policy", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);

    const headers = response.headers();
    const csp = headers["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    // No remote script or connect origins are permitted.
    expect(csp).not.toMatch(/script-src[^;]*https?:/);
    expect(csp).not.toMatch(/connect-src[^;]*https?:/);

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });

  test("API responses are never cached and never sniffed", async ({ api }) => {
    const response = await api.get("/api/events?from=2026-09-01&to=2026-09-30");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("hashed static assets are cached immutably", async ({ request }) => {
    const shell = await (await request.get("/")).text();
    const asset = shell.match(/\/_next\/static\/[^"']+\.js/)?.[0];
    expect(asset, "expected a hashed script in the shell").toBeTruthy();

    const response = await request.get(asset!);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("immutable");
  });

  test("the app shell itself revalidates so a redeploy is picked up", async ({ request }) => {
    const response = await request.get("/");
    expect(response.headers()["cache-control"]).toMatch(/no-cache|no-store/);
  });

  test("no secret values leak into the served page", async ({ request }) => {
    const shell = await (await request.get("/")).text();
    for (const secret of ["test-pepper-not-a-real-secret", "test-session-secret", "testfeedtoken", "testtopic"]) {
      expect(shell, `the shell must not contain ${secret}`).not.toContain(secret);
    }
  });
});
