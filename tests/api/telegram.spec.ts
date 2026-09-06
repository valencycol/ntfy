import { expect, test } from "../support/fixtures";

import { BASE_URL, TEST_BOT_USERNAME } from "../../playwright.config";
import {
  addReminderViaApi,
  clearStub,
  clearTelegramStub,
  resetNotifyChannel,
  resetViaApi,
  seedTelegramChats,
  stubPushes,
  telegramFailNext,
  telegramMessages,
} from "../support/helpers";

const SCHEDULED_URL = `${BASE_URL}/cdn-cgi/local/scheduled`;
const CHAT_ID = "987654321";

test.describe("Telegram as a reminder channel", () => {
  test.beforeEach(async ({ api, admin }) => {
    await resetViaApi(admin);
    await clearStub(api);
    await clearTelegramStub(api);
  });

  // The channel lives in D1, so anything left switched over would redirect
  // every later spec's pushes away from the ntfy stub they assert against.
  test.afterEach(async ({ api }) => resetNotifyChannel(api));

  test("notify-settings starts on ntfy and reports the bot identity", async ({ api }) => {
    const response = await api.get("/api/notify-settings");
    expect(response.status()).toBe(200);

    const settings = await response.json();
    expect(settings.channel).toBe("ntfy");
    expect(settings.telegram.tokenSet).toBe(true);
    expect(settings.telegram.bot).toBe(TEST_BOT_USERNAME);
    expect(settings.telegram.error).toBeNull();
  });

  test("discover reports the chats that have messaged the bot", async ({ api }) => {
    await seedTelegramChats(api, [{ id: 987654321, type: "private", first_name: "Valency" }]);

    const response = await api.post("/api/telegram/discover");
    expect(response.status(), await response.text()).toBe(200);

    const { chats } = await response.json();
    expect(chats).toEqual([{ id: CHAT_ID, name: "Valency", type: "private" }]);
  });

  test("discover returns nothing before anyone has started the bot", async ({ api }) => {
    const { chats } = await (await api.post("/api/telegram/discover")).json();
    expect(chats).toEqual([]);
  });

  test("the channel can be switched to Telegram and comes back on the next read", async ({ api }) => {
    const saved = await api.put("/api/notify-settings", { data: { channel: "telegram", telegram_chat_id: CHAT_ID } });
    expect(saved.status(), await saved.text()).toBe(200);

    const settings = await (await api.get("/api/notify-settings")).json();
    expect(settings.channel).toBe("telegram");
    expect(settings.telegram.chatId).toBe(CHAT_ID);
  });

  test("switching to Telegram without a chat is refused", async ({ api }) => {
    const response = await api.put("/api/notify-settings", { data: { channel: "telegram", telegram_chat_id: "" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/link a telegram chat/i);

    // And the setting is untouched, rather than half-applied.
    expect((await (await api.get("/api/notify-settings")).json()).channel).toBe("ntfy");
  });

  test("a malformed chat ID is refused", async ({ api }) => {
    const response = await api.put("/api/notify-settings", { data: { channel: "ntfy", telegram_chat_id: "not a chat" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/chat id/i);
  });

  test("an unknown channel is refused", async ({ api }) => {
    const response = await api.put("/api/notify-settings", { data: { channel: "carrier-pigeon", telegram_chat_id: "" } });
    expect(response.status()).toBe(400);
  });

  test("the test message goes to Telegram whatever the channel is set to", async ({ api }) => {
    // Still on ntfy: testing Telegram before trusting it with reminders is
    // the whole point of the button.
    const response = await api.post("/api/telegram/test", { data: { telegram_chat_id: CHAT_ID } });
    expect(response.status(), await response.text()).toBe(200);

    const messages = await telegramMessages(api);
    expect(messages).toHaveLength(1);
    expect(messages[0].chat_id).toBe(CHAT_ID);
    expect(await stubPushes(api)).toHaveLength(0);
  });

  test("the test message surfaces Telegram's own reason when it fails", async ({ api }) => {
    await telegramFailNext(api, 1);

    const response = await api.post("/api/telegram/test", { data: { telegram_chat_id: CHAT_ID } });
    expect(response.status()).toBe(502);
    expect((await response.json()).error).toContain("chat not found");
  });

  test("firing a reminder on the Telegram channel sends there and not to ntfy", async ({ api }) => {
    await api.put("/api/notify-settings", { data: { channel: "telegram", telegram_chat_id: CHAT_ID } });
    const id = await addReminderViaApi(api, "Dentist", 30);

    const response = await api.post(`/api/reminders/${id}/fire`);
    expect(response.status(), await response.text()).toBe(200);

    const messages = await telegramMessages(api);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain("Dentist");
    expect(messages[0].text).toContain("Coming up");
    expect(await stubPushes(api)).toHaveLength(0);
  });

  test("the cron delivers due reminders over Telegram", async ({ api }) => {
    await api.put("/api/notify-settings", { data: { channel: "telegram", telegram_chat_id: CHAT_ID } });
    await addReminderViaApi(api, "Standup", -1);

    expect((await api.get(SCHEDULED_URL)).status()).toBe(200);

    const messages = await telegramMessages(api);
    expect(messages.some(m => m.text.includes("Standup"))).toBeTruthy();
  });

  test("on Both, one message goes to each channel", async ({ api }) => {
    await api.put("/api/notify-settings", { data: { channel: "both", telegram_chat_id: CHAT_ID } });
    const id = await addReminderViaApi(api, "Dentist", 30);

    expect((await api.post(`/api/reminders/${id}/fire`)).status()).toBe(200);

    expect(await telegramMessages(api)).toHaveLength(1);
    expect(await stubPushes(api)).toHaveLength(1);
  });

  test("on Both, a reminder still counts as delivered when Telegram is down", async ({ api }) => {
    await api.put("/api/notify-settings", { data: { channel: "both", telegram_chat_id: CHAT_ID } });
    await telegramFailNext(api, 1);
    const id = await addReminderViaApi(api, "Dentist", 30);

    // ntfy took it, so the reminder is done — retrying would re-send there.
    expect((await api.post(`/api/reminders/${id}/fire`)).status()).toBe(200);
    expect(await stubPushes(api)).toHaveLength(1);

    const { upcoming } = await (await api.get("/api/upcoming")).json();
    expect(upcoming.map((r: { id: string }) => r.id)).not.toContain(id);
  });

  test("on Telegram only, a failure is reported with both channels' reasons", async ({ api }) => {
    await api.put("/api/notify-settings", { data: { channel: "telegram", telegram_chat_id: CHAT_ID } });
    await telegramFailNext(api, 1);
    const id = await addReminderViaApi(api, "Dentist", 30);

    const response = await api.post(`/api/reminders/${id}/fire`);
    expect(response.status()).toBe(502);
    expect((await response.json()).error).toContain("telegram:");

    // Unfired, so it is still on the list and will be retried.
    const { upcoming } = await (await api.get("/api/upcoming")).json();
    expect(upcoming.map((r: { id: string }) => r.id)).toContain(id);
  });

  test("the ad-hoc message follows the selected channel", async ({ api }) => {
    await api.put("/api/notify-settings", { data: { channel: "telegram", telegram_chat_id: CHAT_ID } });

    expect((await api.post("/api/notify", { data: { message: "Hello over Telegram" } })).status()).toBe(200);

    expect(JSON.stringify(await telegramMessages(api))).toContain("Hello over Telegram");
    expect(await stubPushes(api)).toHaveLength(0);
  });

  test("Telegram HTML is escaped, not interpreted", async ({ api }) => {
    await api.put("/api/notify-settings", { data: { channel: "telegram", telegram_chat_id: CHAT_ID } });

    expect((await api.post("/api/notify", { data: { message: "<b>bold</b> & <i>italic</i>" } })).status()).toBe(200);

    const [message] = await telegramMessages(api);
    expect(message.text).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; &lt;i&gt;italic&lt;/i&gt;");
  });
});
