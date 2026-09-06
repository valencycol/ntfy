import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

import { NTFY_STUB_URL, TELEGRAM_STUB_URL, TEST_PATTERN, TEST_SUPERUSER_PHRASE, TEST_TZ } from "../../playwright.config";

import type { APIRequestContext, Page } from "@playwright/test";

const D1_ARGS = ["wrangler", "d1", "execute", "events", "--local", "--persist-to", ".wrangler/test-state"];

/** Runs SQL against the test D1. Throws with wrangler's own output on failure. */
export function sql(statement: string) {
  return execFileSync("npx", [...D1_ARGS, "--command", statement, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function query<T = Record<string, unknown>>(statement: string): T[] {
  const raw = sql(statement);
  // wrangler prints a banner before the JSON; take from the first bracket.
  const parsed = JSON.parse(raw.slice(raw.indexOf("[")));
  return parsed[0]?.results ?? [];
}

/**
 * Restores the fixture rows. Call in beforeEach for any spec that mutates.
 * Verifies its own work: a seed that silently no-ops leaves later specs
 * asserting against another test's leftovers, which is confusing to debug.
 */
export function reseed() {
  try {
    execFileSync("npx", [...D1_ARGS, "--file", "tests/seed.sql"], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr: unknown }).stderr) : String(error);
    throw new Error(`reseed failed to run:\n${stderr}`);
  }

  const rows = query<{ n: number; titles: string }>(
    "SELECT COUNT(*) AS n, COALESCE(GROUP_CONCAT(title), '') AS titles FROM events"
  );
  const { n, titles } = rows[0] ?? { n: -1, titles: "" };

  if (n !== FIXTURE_EVENT_COUNT || !titles.includes("Standup")) {
    throw new Error(`reseed ran but the database holds ${n} events (expected ${FIXTURE_EVENT_COUNT}): ${titles}`);
  }
}

/** How many rows tests/seed.sql inserts. */
export const FIXTURE_EVENT_COUNT = 9;

export function epoch(offsetSeconds = 0) {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

/** Inserts a reminder row due at `notifyAt`, returning its id. */
export function addReminder(eventId: string, notifyAt: number, id?: string) {
  const reminderId = id ?? crypto.randomUUID();
  sql(`INSERT INTO reminders (id, event_id, notify_at, notified_at, attempts) VALUES ('${reminderId}', '${eventId}', ${notifyAt}, NULL, 0)`);
  return reminderId;
}

// ---------------------------------------------------------------------------
// Fixtures, seeded through the API

/**
 * The fixture set, posted through /api/events rather than written straight to
 * SQLite. Seeding out-of-band proved unreliable: the running Worker kept
 * serving a stale view of externally-written rows, so specs asserted against
 * another test's leftovers. Everything here goes through the app itself, so
 * what the tests set up is exactly what the server sees.
 */
export const FIXTURE_EVENTS = [
  { title: "Standup", notes: "Daily sync", uid: "seed-standup", start_date: "2026-09-04", end_date: "2026-09-04",
    start_time: "09:15", end_time: "09:30", all_day: 0, color: "#2563eb", repeat_yearly: 0, reminder_times: ["09:00"] },
  { title: "Dentist", notes: null, uid: "seed-dentist", start_date: "2026-09-04", end_date: "2026-09-04",
    start_time: "14:00", end_time: "15:00", all_day: 0, color: "#dc2626", repeat_yearly: 0, reminder_times: ["00:00", "09:00", "13:45"] },
  { title: "Mum birthday", notes: null, uid: "seed-birthday", start_date: "1968-09-07", end_date: "1968-09-07",
    all_day: 1, color: "#9333ea", repeat_yearly: 1, reminder_times: ["00:00", "09:00"] },
  { title: "Conference", notes: "Three days", uid: "seed-conference", start_date: "2026-09-09", end_date: "2026-09-11",
    all_day: 1, color: "#16a34a", repeat_yearly: 0, reminder_times: ["09:00"] },
  { title: "Public holiday", notes: null, uid: "seed-holiday", start_date: "2026-09-21", end_date: "2026-09-21",
    all_day: 1, color: "#ca8a04", repeat_yearly: 0, reminder_times: [] },
  { title: "Anniversary", notes: null, uid: "seed-anniversary", start_date: "2015-10-02", end_date: "2015-10-02",
    all_day: 1, color: "#ea580c", repeat_yearly: 1, reminder_times: ["00:00", "09:00"] },
  { title: "Late meeting", notes: null, uid: "seed-late", start_date: "2026-09-04", end_date: "2026-09-04",
    start_time: "17:00", end_time: "19:00", all_day: 0, color: "#525252", repeat_yearly: 0, reminder_times: ["16:45"] },
  { title: "Leap day thing", notes: null, uid: "seed-leapday", start_date: "2000-02-29", end_date: "2000-02-29",
    all_day: 1, color: "#2563eb", repeat_yearly: 1, reminder_times: ["09:00"] },

  // Deliberately past the 300-character preview cut-off.
  { title: "Long note meeting", notes: "Agenda: item 1 discussed at length item 2 discussed at length item 3 discussed at length item 4 discussed at length item 5 discussed at length item 6 discussed at length item 7 discussed at length item 8 discussed at length item 9 discussed at length item 10 discussed at length item 11 discussed at length item 12 discussed at length item 13 discussed at length item 14 discussed at length item 15 discussed at length item 16 discussed at length item 17 discussed at length item 18 discussed at length item 19 discussed at length item 20 discussed at length item 21 discussed at length item 22 discussed at length item 23 discussed at length item 24 discussed at length item 25 discussed at length item 26 discussed at length item 27 discussed at length item 28 discussed at length item 29 discussed at length item 30 discussed at length END-OF-NOTE", uid: "seed-longnote", start_date: "2026-09-16", end_date: "2026-09-16",
    start_time: "11:00", end_time: "12:00", all_day: 0, color: "#9333ea", repeat_yearly: 0, reminder_times: [] },
] as const;

/** Real row ids of the fixtures, filled in by the most recent reset. */
const fixtureIds = new Map<string, string>();

export function fixtureId(title: string): string {
  const id = fixtureIds.get(title);
  if (!id) throw new Error(`No fixture called "${title}" — was resetViaApi awaited in beforeEach?`);
  return id;
}

/**
 * Clears every event and reinstates the fixtures, all through the API.
 * Deleting now needs the superuser capability, so this takes one for the
 * duration and gives it back — every spec then starts in the default state
 * where deleting is switched off.
 */
export async function resetViaApi(admin: APIRequestContext) {
  const listing = await admin.get("/api/events?from=0000-01-01&to=9999-12-31");
  expect(listing.status(), `could not list events: ${await listing.text()}`).toBe(200);

  const { events } = (await listing.json()) as { events: { id: string }[] };
  for (const id of new Set(events.map(e => e.id))) {
    const deleted = await admin.delete(`/api/events/${id}`);
    expect(deleted.status(), `could not delete ${id}`).toBe(200);
  }

  fixtureIds.clear();
  for (const event of FIXTURE_EVENTS) {
    const created = await admin.post("/api/events", { data: event });
    expect(created.status(), `could not seed "${event.title}": ${await created.text()}`).toBe(200);
    fixtureIds.set(event.title, (await created.json()).id);
  }

  // Creating an event arms its reminders, and the fixtures sit on today's
  // date — which would leave every spec starting with a crowded "due soon"
  // list. Specs arm what they need with addReminderViaApi instead.
  for (const row of query<{ id: string }>("SELECT id FROM reminders")) {
    await admin.delete(`/api/reminders/${row.id}`);
  }
}

/**
 * Gives an event a reminder `minutesFromNow` from now by moving it to today
 * and setting that clock time — the Worker then creates the reminder row
 * itself, so it is immediately visible to every later request.
 */
export async function addReminderViaApi(api: APIRequestContext, title: string, minutesFromNow: number) {
  const at = new Date(Date.now() + minutesFromNow * 60_000);

  // Read the wall clock in the Worker's timezone, not the runner's: the
  // Worker turns "2026-09-05" + "14:30" into an instant using TZ_NAME, so a
  // runner on UTC would arm the reminder hours away from when it meant to.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)!.value;

  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const clock = `${part("hour")}:${part("minute")}`;

  const source = FIXTURE_EVENTS.find(e => e.title === title)!;
  const response = await api.patch(`/api/events/${fixtureId(title)}`, {
    data: { ...source, start_date: today, end_date: today, reminder_times: [clock] },
  });
  expect(response.status(), `could not arm a reminder on "${title}": ${await response.text()}`).toBe(200);

  const { upcoming } = await (await api.get("/api/upcoming")).json();
  const row = upcoming.find((r: { title: string }) => r.title === title);
  expect(row, `"${title}" did not appear in /api/upcoming after arming it`).toBeTruthy();
  return row.id as string;
}

// ---------------------------------------------------------------------------
// ntfy stub

export interface IStubPush {
  topic: string;
  at: number;
  body: { title?: string; message?: string; tags?: string[]; priority?: number; [k: string]: unknown };
}

export async function stubPushes(request: APIRequestContext): Promise<IStubPush[]> {
  const response = await request.get(`${NTFY_STUB_URL}/__pushes`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).pushes;
}

export async function clearStub(request: APIRequestContext) {
  await request.delete(`${NTFY_STUB_URL}/__pushes`);
}

export async function stubFailNext(request: APIRequestContext, count = 1) {
  await request.post(`${NTFY_STUB_URL}/__fail`, { data: { count } });
}

// ---------------------------------------------------------------------------
// Telegram stub

export interface IStubTelegramMessage {
  at: number;
  chat_id: string;
  text: string;
}

export interface IStubChat {
  id: number | string;
  type: string;
  first_name?: string;
  title?: string;
  username?: string;
}

export async function telegramMessages(request: APIRequestContext): Promise<IStubTelegramMessage[]> {
  const response = await request.get(`${TELEGRAM_STUB_URL}/__messages`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).messages;
}

/** Also clears the seeded getUpdates chats and any pending failure. */
export async function clearTelegramStub(request: APIRequestContext) {
  await request.delete(`${TELEGRAM_STUB_URL}/__messages`);
}

/** Seeds the chats the bot's getUpdates will report, as if they had messaged it. */
export async function seedTelegramChats(request: APIRequestContext, chats: IStubChat[]) {
  await request.post(`${TELEGRAM_STUB_URL}/__updates`, { data: { chats } });
}

export async function telegramFailNext(request: APIRequestContext, count = 1) {
  await request.post(`${TELEGRAM_STUB_URL}/__fail`, { data: { count } });
}

/** Makes the stub reject getUpdates the way Telegram does when a webhook is registered. */
export async function telegramWebhookActive(request: APIRequestContext, active = true) {
  await request.post(`${TELEGRAM_STUB_URL}/__webhook`, { data: { active } });
}

/**
 * Puts the notification channel back to ntfy-only. Every spec that touches
 * the setting must call this afterwards: it is stored in D1, so leaving it on
 * Telegram would silently redirect every later spec's pushes away from the
 * ntfy stub they assert against.
 */
export async function resetNotifyChannel(request: APIRequestContext) {
  const response = await request.put("/api/notify-settings", { data: { channel: "ntfy", telegram_chat_id: "" } });
  expect(response.status(), `could not reset the notify channel: ${await response.text()}`).toBe(200);
}

// ---------------------------------------------------------------------------
// auth

/** Authenticates an APIRequestContext, leaving the session cookie in its jar. */
export async function login(request: APIRequestContext) {
  const response = await request.post("/api/login", { data: { pattern: TEST_PATTERN.join("") } });
  expect(response.status(), await response.text()).toBe(200);
}

async function dotCentres(page: Page, sequence: number[]) {
  await page.waitForSelector(".dot");
  const centres = [];
  for (const index of sequence) {
    const box = await page.locator(".dot").nth(index).boundingBox();
    if (!box) throw new Error(`dot ${index} has no bounding box`);
    centres.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return centres;
}

/**
 * Draws the unlock pattern as a single pointer drag, which is how the lock
 * submits — on pointerup, with no button to press.
 */
export async function drawPattern(page: Page, sequence: number[] = TEST_PATTERN) {
  const centres = await dotCentres(page, sequence);

  await page.mouse.move(centres[0].x, centres[0].y);
  await page.mouse.down();
  for (const point of centres.slice(1)) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
}

/**
 * Taps each dot in turn, which is the path a keyboard or switch user takes and
 * the only one available under WebKit's touch emulation, where synthesised
 * mouse events do not produce pointer events. The lock auto-submits shortly
 * after the fourth dot rather than waiting for a gesture that never ends.
 */
export async function tapPattern(page: Page, sequence: number[] = TEST_PATTERN) {
  await page.waitForSelector(".dot");
  for (const index of sequence) await page.locator(".dot").nth(index).click();
}

/** True when the context emulates touch, where dragging cannot be synthesised. */
function isTouch(page: Page) {
  return page.evaluate(() => "ontouchstart" in window || navigator.maxTouchPoints > 0);
}

/** Loads the app and unlocks it, resolving once the calendar has rendered. */
export async function unlock(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dot");

  const draw = async () => {
    if (await isTouch(page)) await tapPattern(page);
    else await drawPattern(page);
  };

  await draw();

  // The throttling spec can leave this IP locked out; clear it and try again
  // rather than making every UI spec depend on running order.
  if (await page.locator(".lockmsg").filter({ hasText: /Too many attempts/ }).count()) {
    sql("DELETE FROM auth_attempts");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".dot");
    await draw();
  }

  await expect(page.locator(".lock")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Colaco Calendar/ })).toBeVisible();
  // The first event fetch resolves right after unlock; wait for the header's
  // event count so assertions don't race an empty grid.
  await expect(page.getByText(/\d+ events?/)).toBeVisible({ timeout: 15_000 });
}

/**
 * Sets a react-aria TimeField. Its segments are focusable `spinbutton` divs
 * rather than inputs, so they take typed digits rather than `fill()`.
 * `field` is the aria-label, e.g. "Start time"; `time` is 24-hour "HH:MM".
 */
export async function setTime(page: Page, field: string, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const meridiem = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  await page.getByRole("spinbutton", { name: `hour, ${field}` }).click();
  await page.keyboard.type(String(hour12).padStart(2, "0"));
  await page.getByRole("spinbutton", { name: `minute, ${field}` }).click();
  await page.keyboard.type(String(minute).padStart(2, "0"));
  await page.getByRole("spinbutton", { name: `AM/PM, ${field}` }).click();
  await page.keyboard.type(meridiem[0]);
}

/**
 * Deleting is off by default; this types the command that switches it on, the
 * same way a person would.
 */
export async function enableSuperuser(page: Page) {
  await page.getByLabel("Search all events").fill("enter superuser");
  await page.getByLabel("Search all events").press("Enter");

  // The phrase goes into a masked field, never the search box.
  await expect(page.getByRole("heading", { name: "Enable superuser" })).toBeVisible();
  await page.getByLabel("Passphrase").fill(TEST_SUPERUSER_PHRASE);
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText(/Superuser enabled/)).toBeVisible();
}


/**
 * A successful login makes the Worker clear that IP's failure counter, which
 * is the only reliable way to undo them — once a lockout is active the check
 * short-circuits before the pattern is even examined. Specs that submit a
 * wrong pattern call this so their failures never accumulate towards one.
 */
export async function clearLoginFailures(api: APIRequestContext) {
  const response = await api.post("/api/login", { data: { pattern: TEST_PATTERN.join("") } });
  expect(response.status(), "could not reset the login failure counter").toBe(200);
}

/** Fails the test unless the page produced no console errors or exceptions. */
export function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`[pageerror] ${error.message}`));
  page.on("console", message => {
    if (message.type() !== "error") return;
    // The initial session probe is expected to 401 before unlocking.
    if (message.text().includes("401")) return;
    errors.push(`[console] ${message.text()}`);
  });
  return errors;
}
