import { defineConfig, devices } from "@playwright/test";

export const BASE_URL = "http://127.0.0.1:8788";
export const NTFY_STUB_URL = "http://127.0.0.1:8799";

/** The pattern tests/test.env's PATTERN_HASH corresponds to. Draws a "7". */
export const TEST_PATTERN = [0, 1, 2, 4, 7];

/**
 * A throwaway superuser phrase matching tests/test.env's SUPERUSER_HASH. The
 * real one is only ever a hashed Cloudflare secret, so it never enters the repo.
 */
export const TEST_SUPERUSER_PHRASE = "open-sesame-test-only";

/** Mirrors MAX_FAILS in src/index.js; production is not overridden. */
export const MAX_FAILS_BEFORE_LOCKOUT = 5;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./tests/.results",
  globalSetup: "./tests/support/global-setup.ts",

  // One worker: every spec shares a single wrangler dev process and one local
  // D1, and specs reseed that database, so they cannot safely run in parallel.
  workers: 1,
  fullyParallel: false,

  forbidOnly: !!process.env.CI,
  // One retry. `wrangler dev` occasionally emits a transient error part-way
  // through a nine-minute run and drops a request, which used to fail the
  // deploy gate for reasons that had nothing to do with the app. A real
  // failure still fails twice; a blip does not block a release.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [["list"], ["json", { outputFile: "tests/.results/report.json" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    // API-level checks first: they are fast and, if the Worker is broken,
    // failing here says so far more clearly than a UI timeout would.
    { name: "api", testDir: "./tests/api", use: { ...devices["Desktop Chrome"] } },
    { name: "ui", testDir: "./tests/ui", dependencies: ["api"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      // Chromium at an iPhone viewport rather than devices["iPhone 13"]: these
      // specs assert CSS layout, which emulates faithfully, and WebKit's touch
      // emulation cannot synthesise the pointer drag the lock screen needs.
      name: "mobile",
      testDir: "./tests/mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: false, hasTouch: true },
    },
    {
      // Last on purpose: this one trips the 15-minute per-IP login lockout,
      // which cannot be cleared from outside a running Miniflare, so nothing
      // may be scheduled after it.
      name: "throttle",
      testDir: "./tests/throttle",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: "node tests/support/ntfy-stub.mjs",
      url: `${NTFY_STUB_URL}/__pushes`,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // Isolated from `npm run dev`: its own port, its own D1 persistence
      // directory, and throwaway secrets, so a test run never touches the
      // developer's local data or the real ntfy server.
      command: [
        "npx wrangler dev",
        "--local",
        "--port 8788",
        "--persist-to .wrangler/test-state",
        "--env-file tests/test.env",
        `--var NTFY_SERVER:${NTFY_STUB_URL}`,
        "--var TZ_NAME:Europe/Stockholm",
      ].join(" "),
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
    },
  ],
});
