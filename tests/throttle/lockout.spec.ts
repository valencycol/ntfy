import { expect, test } from "@playwright/test";

import { BASE_URL, MAX_FAILS_BEFORE_LOCKOUT, TEST_PATTERN, TEST_SUPERUSER_PHRASE } from "../../playwright.config";
import { reseed, sql } from "../support/helpers";

import type { APIRequestContext, Playwright } from "@playwright/test";

const CORRECT = TEST_PATTERN.join("");

/**
 * Lockouts are counted per client IP and cannot be cleared from outside a
 * running Miniflare, so tests that trip one would otherwise poison each other
 * and everything scheduled after them. Giving each test its own
 * CF-Connecting-IP makes them independent — and this project still runs last,
 * so a stray lockout cannot reach the rest of the suite either.
 */
let nextIp = 0;
function nextClientIp() {
  nextIp += 1;
  return `203.0.113.${nextIp}`;
}

/** A client with its own IP and no session — for testing login itself. */
async function isolatedClient(playwright: Playwright, ip = nextClientIp()): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { "CF-Connecting-IP": ip } });
}

/**
 * The same, but carrying a session. The cookie is issued `Secure`, which an
 * http:// context refuses to store, so it is replayed as a header — without
 * this every authenticated call quietly answers 401 instead of what is
 * actually being tested.
 */
async function isolatedSessionClient(playwright: Playwright): Promise<APIRequestContext> {
  const ip = nextClientIp();
  const anon = await isolatedClient(playwright, ip);

  const login = await anon.post("/api/login", { data: { pattern: CORRECT } });
  expect(login.status(), `login failed: ${await login.text()}`).toBe(200);
  const sid = (login.headers()["set-cookie"] ?? "").match(/sid=([^;]+)/)?.[1];
  expect(sid, "login returned no session cookie").toBeTruthy();
  await anon.dispose();

  return playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { "CF-Connecting-IP": ip, cookie: `sid=${sid}` },
  });
}

test.describe("login throttling", () => {
  test.beforeEach(() => {
    reseed();
    sql("DELETE FROM auth_attempts");
  });

  test("locks the IP out after enough wrong patterns", async ({ playwright }) => {
    const client = await isolatedClient(playwright);

    // Exactly the allowed number of failures: each refused, none throttled.
    for (let attempt = 1; attempt <= MAX_FAILS_BEFORE_LOCKOUT; attempt++) {
      const response = await client.post("/api/login", { data: { pattern: "9999" } });
      expect(response.status(), `attempt ${attempt} should be refused, not throttled`).toBe(401);
    }

    const throttled = await client.post("/api/login", { data: { pattern: "9999" } });
    expect(throttled.status(), "one failure past the limit should be throttled").toBe(429);
    expect((await throttled.json()).error).toMatch(/too many|try again/i);

    await client.dispose();
  });

  test("the correct pattern is refused too while the lockout stands", async ({ playwright }) => {
    const client = await isolatedClient(playwright);

    for (let attempt = 1; attempt <= MAX_FAILS_BEFORE_LOCKOUT; attempt++) {
      await client.post("/api/login", { data: { pattern: "9999" } });
    }

    // Being right does not help once the door is bolted.
    expect((await client.post("/api/login", { data: { pattern: CORRECT } })).status()).toBe(429);
    await client.dispose();
  });

  test("a successful login clears the counter before a lockout is reached", async ({ playwright }) => {
    const client = await isolatedClient(playwright);

    for (let attempt = 1; attempt < MAX_FAILS_BEFORE_LOCKOUT; attempt++) {
      expect((await client.post("/api/login", { data: { pattern: "9999" } })).status()).toBe(401);
    }

    expect((await client.post("/api/login", { data: { pattern: CORRECT } })).status()).toBe(200);

    // The counter is reset, so the next wrong attempt starts from scratch
    // rather than tipping straight into a lockout.
    expect((await client.post("/api/login", { data: { pattern: "9999" } })).status()).toBe(401);
    await client.dispose();
  });

  test("one client's lockout does not affect another", async ({ playwright }) => {
    const victim = await isolatedClient(playwright);
    const bystander = await isolatedClient(playwright);

    for (let attempt = 0; attempt <= MAX_FAILS_BEFORE_LOCKOUT; attempt++) {
      await victim.post("/api/login", { data: { pattern: "9999" } });
    }
    expect((await victim.post("/api/login", { data: { pattern: CORRECT } })).status()).toBe(429);

    // Throttling is per client, not a global switch that locks the whole app.
    expect((await bystander.post("/api/login", { data: { pattern: CORRECT } })).status()).toBe(200);

    await victim.dispose();
    await bystander.dispose();
  });
});

test.describe("superuser passphrase throttling", () => {
  test.beforeEach(() => {
    reseed();
    sql("DELETE FROM auth_attempts");
  });

  test("guessing the passphrase is throttled", async ({ playwright }) => {
    const client = await isolatedSessionClient(playwright);

    let throttled = false;
    for (let attempt = 0; attempt < MAX_FAILS_BEFORE_LOCKOUT + 3; attempt++) {
      const response = await client.post("/api/superuser", { data: { phrase: `guess-${attempt}` } });
      if (response.status() === 429) {
        throttled = true;
        break;
      }
      expect(response.status(), "a wrong phrase should be refused").toBe(401);
    }

    expect(throttled, "repeated wrong passphrases should be throttled").toBeTruthy();
    await client.dispose();
  });

  test("guessing the passphrase does not lock you out of the calendar", async ({ playwright }) => {
    const client = await isolatedSessionClient(playwright);

    for (let attempt = 0; attempt < MAX_FAILS_BEFORE_LOCKOUT + 2; attempt++) {
      await client.post("/api/superuser", { data: { phrase: "wrong" } });
    }

    // The two counters are separate, so failing one does not bar the other.
    expect((await client.post("/api/login", { data: { pattern: CORRECT } })).status()).toBe(200);
    await client.dispose();
  });

  test("the right passphrase still works from a clean client", async ({ playwright }) => {
    const client = await isolatedSessionClient(playwright);

    const granted = await client.post("/api/superuser", { data: { phrase: TEST_SUPERUSER_PHRASE } });
    expect(granted.status(), await granted.text()).toBe(200);
    await client.dispose();
  });
});
