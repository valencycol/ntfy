import { expect, test } from "@playwright/test";

import { TEST_PATTERN } from "../../playwright.config";
import { reseed } from "../support/helpers";

const CORRECT = TEST_PATTERN.join("");

test.describe("authentication", () => {
  test.beforeEach(() => reseed());
  // The lockout test lives in tests/throttle/, which runs after every other
  // project — a 15-minute per-IP lockout cannot be undone from outside a
  // running Miniflare, so nothing may run after it.

  test("rejects the wrong pattern without leaking which part was wrong", async ({ request }) => {
    const response = await request.post("/api/login", { data: { pattern: "0000" } });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("That pattern is not right.");
    expect(JSON.stringify(body)).not.toContain(CORRECT);
  });

  test("rejects a malformed body", async ({ request }) => {
    const response = await request.post("/api/login", { headers: { "content-type": "application/json" }, data: "not json" });
    expect([400, 401]).toContain(response.status());
  });

  test("accepts the correct pattern and sets an HttpOnly session cookie", async ({ request }) => {
    const response = await request.post("/api/login", { data: { pattern: CORRECT } });
    expect(response.status()).toBe(200);

    const setCookie = response.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("sid=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
  });

  test("every data endpoint is gated behind a session", async ({ request }) => {
    const gated: [string, "get" | "post" | "patch" | "delete"][] = [
      ["/api/events?from=2026-01-01&to=2026-12-31", "get"],
      ["/api/events", "post"],
      ["/api/events/11111111-1111-4111-8111-111111111111", "patch"],
      ["/api/events/11111111-1111-4111-8111-111111111111", "delete"],
      ["/api/import", "post"],
      ["/api/import/fetch", "post"],
      ["/api/feed-url", "get"],
      ["/api/ntfy-info", "get"],
      ["/api/upcoming", "get"],
      ["/api/notify", "post"],
    ];

    for (const [path, method] of gated) {
      const response = await request.fetch(path, { method: method.toUpperCase(), data: method === "get" ? undefined : {} });
      expect(response.status(), `${method.toUpperCase()} ${path} should require a session`).toBe(401);
      expect((await response.json()).error).toBe("Locked");
    }
  });

  test("logout tells the browser to drop the session cookie", async ({ request }) => {
    // The session is a stateless signed cookie with no server-side record, so
    // logout can only expire it client-side. That is what is asserted here;
    // the UI consequence (returning to the lock screen) is covered in
    // tests/ui/navigation.spec.ts.
    const logout = await request.post("/api/logout");
    expect(logout.status()).toBe(200);

    const setCookie = logout.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("sid=;");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
  });

  test("the session cookie is issued Secure, HttpOnly and SameSite=Strict", async ({ request }) => {
    const response = await request.post("/api/login", { data: { pattern: CORRECT } });
    const setCookie = response.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  test("a session cookie with a tampered expiry is refused", async ({ playwright }) => {
    const bootstrap = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8788" });
    const response = await bootstrap.post("/api/login", { data: { pattern: CORRECT } });
    const sid = (response.headers()["set-cookie"] ?? "").match(/sid=([^;]+)/)?.[1] ?? "";
    await bootstrap.dispose();

    const [expiry, signature] = sid.split(".");
    // Push the expiry far into the future while keeping the old signature.
    const forged = `${Number(expiry) + 86_400_000}.${signature}`;

    const context = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8788", extraHTTPHeaders: { cookie: `sid=${forged}` } });
    expect((await context.get("/api/events?from=2026-09-01&to=2026-09-30")).status()).toBe(401);
    await context.dispose();
  });

  test("a forged session cookie is refused", async ({ playwright }) => {
    const context = await playwright.request.newContext({
      baseURL: process.env.PW_BASE_URL || "http://127.0.0.1:8788",
      extraHTTPHeaders: { cookie: "sid=forged.signature" },
    });
    const response = await context.get("/api/events?from=2026-09-01&to=2026-09-30");
    expect(response.status()).toBe(401);
    await context.dispose();
  });
});
