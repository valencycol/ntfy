import { expect, test } from "../support/fixtures";

import { BASE_URL } from "../../playwright.config";
import { addReminderViaApi, clearStub, epoch, fixtureId, query, resetViaApi, stubFailNext, stubPushes } from "../support/helpers";

const SCHEDULED_URL = `${BASE_URL}/cdn-cgi/local/scheduled`;


test.describe("reminders and ntfy delivery", () => {
  test.beforeEach(async ({ api, admin }) => {
    await resetViaApi(admin);
    await clearStub(api);
  });

  test("upcoming lists only reminders due inside the next 48 hours", async ({ api }) => {
    await addReminderViaApi(api, "Standup", 30); // due soon
    await addReminderViaApi(api, "Dentist", 90); // also inside the window

    const response = await api.get("/api/upcoming");
    expect(response.status()).toBe(200);
    const { upcoming } = await response.json();

    // Only the two just armed are due; the other fixtures sit in September.
    const armed = upcoming.filter((r: { title: string }) => ["Standup", "Dentist"].includes(r.title));
    expect(armed).toHaveLength(2);
    expect(armed[0].notify_at).toBeLessThan(armed[1].notify_at);
    expect(armed[0]).toHaveProperty("title");
  });

  test("upcoming includes overdue reminders that have not fired", async ({ api }) => {
    await addReminderViaApi(api, "Standup", -10);
    const { upcoming } = await (await api.get("/api/upcoming")).json();
    expect(upcoming.some((r: { title: string }) => r.title === "Standup")).toBeTruthy();
  });

  test("upcoming excludes reminders already sent", async ({ api }) => {
    const id = await addReminderViaApi(api, "Standup", 10);
    // Firing it is how a reminder gets marked sent, server-side.
    expect((await api.post(`/api/reminders/${id}/fire`)).status()).toBe(200);

    const { upcoming } = await (await api.get("/api/upcoming")).json();
    expect(upcoming.map((r: { id: string }) => r.id)).not.toContain(id);
  });

  test("firing a reminder pushes to ntfy and marks it sent", async ({ api }) => {
    const id = await addReminderViaApi(api, "Dentist", 30);

    const response = await api.post(`/api/reminders/${id}/fire`);
    expect(response.status(), await response.text()).toBe(200);

    const pushes = await stubPushes(api);
    expect(pushes).toHaveLength(1);
    expect(JSON.stringify(pushes[0].body)).toContain("Dentist");

    const [row] = query<{ notified_at: number | null }>(`SELECT notified_at FROM reminders WHERE id = '${id}'`);
    expect(row.notified_at).not.toBeNull();

    // It should then drop off the upcoming list.
    const { upcoming } = await (await api.get("/api/upcoming")).json();
    expect(upcoming.map((r: { id: string }) => r.id)).not.toContain(id);
  });

  test("a rejected push is reported and the reminder is not marked sent", async ({ api }) => {
    const id = await addReminderViaApi(api, "Dentist", 30);
    await clearStub(api);
    await stubFailNext(api, 1);

    const response = await api.post(`/api/reminders/${id}/fire`);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect((await response.json()).error).toBeTruthy();

    const [row] = query<{ notified_at: number | null; attempts: number }>(`SELECT notified_at, attempts FROM reminders WHERE id = '${id}'`);
    expect(row.notified_at).toBeNull();
  });

  test("cancelling a reminder deletes it without touching its event", async ({ api }) => {
    const id = await addReminderViaApi(api, "Dentist", 30);

    const response = await api.delete(`/api/reminders/${id}`);
    expect(response.status()).toBe(200);

    const { upcoming } = await (await api.get("/api/upcoming")).json();
    expect(upcoming.map((r: { id: string }) => r.id)).not.toContain(id);
    expect(query(`SELECT * FROM events WHERE id = '${fixtureId("Dentist")}'`)).toHaveLength(1);
    expect(await stubPushes(api)).toHaveLength(0);
  });

  test("an ad-hoc message reaches ntfy verbatim", async ({ api }) => {
    const response = await api.post("/api/notify", { data: { message: "Hello from the test suite" } });
    expect(response.status(), await response.text()).toBe(200);

    const pushes = await stubPushes(api);
    expect(pushes).toHaveLength(1);
    expect(JSON.stringify(pushes[0].body)).toContain("Hello from the test suite");
  });

  test("an empty ad-hoc message is refused", async ({ api }) => {
    const response = await api.post("/api/notify", { data: { message: "   " } });
    expect(response.status()).toBe(400);
    expect(await stubPushes(api)).toHaveLength(0);
  });

  test("the cron sends due reminders exactly once", async ({ api }) => {
    await addReminderViaApi(api, "Standup", -2);
    await addReminderViaApi(api, "Dentist", -1);
    await clearStub(api);

    expect((await api.get(SCHEDULED_URL)).status()).toBe(200);
    await expect.poll(async () => (await stubPushes(api)).length, { timeout: 15_000 }).toBe(2);

    // A second tick must not re-send what already went out.
    expect((await api.get(SCHEDULED_URL)).status()).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect(await stubPushes(api)).toHaveLength(2);

    const sent = query<{ n: number }>("SELECT COUNT(*) AS n FROM reminders WHERE notified_at IS NOT NULL");
    expect(sent[0].n).toBeGreaterThanOrEqual(2);
  });

  test("the cron arms a yearly event for its next occurrence", async ({ api }) => {
    const birthday = fixtureId("Mum birthday");

    // The reset leaves nothing armed, so anything here is the cron's doing.
    expect(query(`SELECT * FROM reminders WHERE event_id = '${birthday}'`)).toHaveLength(0);

    expect((await api.get(SCHEDULED_URL)).status()).toBe(200);

    await expect
      .poll(() => query(`SELECT * FROM reminders WHERE event_id = '${birthday}' AND notified_at IS NULL`).length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    // Dated to the next 7 September, never the 1968 anchor.
    for (const row of query<{ notify_at: number }>(`SELECT notify_at FROM reminders WHERE event_id = '${birthday}'`)) {
      const at = new Date(row.notify_at * 1000);
      expect(at.getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear());
      expect(at.getMonth()).toBe(8); // September
    }
  });

  test("ntfy setup details are exposed for the iPhone dialog", async ({ api }) => {
    const response = await api.get("/api/ntfy-info");
    expect(response.status()).toBe(200);

    const info = await response.json();
    expect(info.server).toBe("http://127.0.0.1:8799");
    expect(info.topic).toBeTruthy();
    expect(info.topicHasStrayWhitespace).toBe(false);
  });
});
