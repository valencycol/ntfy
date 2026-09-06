import { expect, test } from "../support/fixtures";

import { BASE_URL, TEST_BOT_USERNAME } from "../../playwright.config";
import {
  addRecipient,
  addReminderViaApi,
  clearRecipients,
  clearStub,
  clearTelegramStub,
  resetNotifyChannel,
  resetViaApi,
  seedTelegramChats,
  seedTelegramUpdates,
  stubPushes,
  telegramFailNext,
  telegramMessages,
  telegramSettings,
  telegramWebhookActive,
} from "../support/helpers";

const SCHEDULED_URL = `${BASE_URL}/cdn-cgi/local/scheduled`;
const CHAT_ID = "987654321";

/** Adds someone by handle, has them start the bot, and returns their chat id. */
async function link(api: Parameters<typeof addRecipient>[0], name: string, handle: string, chat: Record<string, unknown>) {
  await addRecipient(api, name, handle);
  await seedTelegramChats(api, [chat as never]);
  expect((await api.post("/api/telegram/poll")).status()).toBe(200);
  return String(chat.id);
}

test.describe("Telegram recipients", () => {
  test.beforeEach(async ({ api, admin }) => {
    await resetViaApi(admin);
    await clearStub(api);
    await clearTelegramStub(api);
    await clearRecipients(api);
  });

  // Both are stored in D1: a leftover recipient or channel would redirect the
  // next spec's pushes away from the ntfy stub it asserts against.
  test.afterEach(async ({ api }) => {
    await resetNotifyChannel(api);
    await clearRecipients(api);
  });

  test("starts with nobody, and reports the bot the token belongs to", async ({ api }) => {
    const { channel, telegram } = await telegramSettings(api);
    expect(channel).toBe("ntfy");
    expect(telegram.tokenSet).toBe(true);
    expect(telegram.bot).toBe(TEST_BOT_USERNAME);
    expect(telegram.recipients).toEqual([]);
  });

  test.describe("adding someone", () => {
    test("by @username leaves them pending with an invite link", async ({ api }) => {
      await addRecipient(api, "Alvita", "@alvita");

      const { telegram } = await telegramSettings(api);
      expect(telegram.recipients).toHaveLength(1);

      const [person] = telegram.recipients;
      expect(person.name).toBe("Alvita");
      expect(person.handle).toBe("@alvita");
      // Not linked: the Bot API cannot reach a @username, only a chat id.
      expect(person.chat_id).toBeNull();
      expect(person.invite).toContain(`https://t.me/${TEST_BOT_USERNAME}?start=`);
    });

    test("by phone number also leaves them pending with an invite", async ({ api }) => {
      await addRecipient(api, "Mum", "+46 70 123 45 67");

      const [person] = (await telegramSettings(api)).telegram.recipients;
      expect(person.handle).toBe("+46 70 123 45 67");
      expect(person.chat_id).toBeNull();
      expect(person.invite).toContain("?start=");
    });

    test("by numeric chat ID links immediately, since that is what the API wants", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);

      const [person] = (await telegramSettings(api)).telegram.recipients;
      expect(person.chat_id).toBe(CHAT_ID);
      expect(person.invite).toBeNull();
    });

    test("a name is required", async ({ api }) => {
      const response = await api.post("/api/telegram/recipients", { data: { name: "  ", handle: "@alvita" } });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/name is required/i);
    });

    test.describe("rejects a handle that is neither", () => {
      for (const handle of ["not a handle", "@ab", "javascript:alert(1)", ""]) {
        test(`"${handle}"`, async ({ api }) => {
          const response = await api.post("/api/telegram/recipients", { data: { name: "X", handle } });
          expect(response.status()).toBe(400);
        });
      }
    });
  });

  test.describe("linking", () => {
    test("tapping the invite link binds that person by their code", async ({ api }) => {
      await addRecipient(api, "Alvita", "@alvita");
      const [pending] = (await telegramSettings(api)).telegram.recipients;
      const code = pending.invite!.split("start=")[1];

      // What Telegram sends when someone opens the deep link and taps Start.
      await seedTelegramUpdates(api, [{ chat: { id: 555000111, type: "private", first_name: "Alvita" }, text: `/start ${code}` }]);
      expect((await api.post("/api/telegram/poll")).status()).toBe(200);

      const [person] = (await telegramSettings(api)).telegram.recipients;
      expect(person.chat_id).toBe("555000111");
      // One-time: cleared so a forwarded link cannot bind somebody else.
      expect(person.invite).toBeNull();
    });

    test("a plain Start binds by username when the codes are not used", async ({ api }) => {
      await link(api, "Alvita", "@alvita", { id: 555000222, type: "private", first_name: "Alvita", username: "alvita" });

      const [person] = (await telegramSettings(api)).telegram.recipients;
      expect(person.chat_id).toBe("555000222");
    });

    test("username matching ignores case and a missing @", async ({ api }) => {
      await link(api, "Alvita", "AlViTa", { id: 555000333, type: "private", first_name: "A", username: "alvita" });
      expect((await telegramSettings(api)).telegram.recipients[0].chat_id).toBe("555000333");
    });

    test("a shared contact binds the person invited by phone number", async ({ api }) => {
      await addRecipient(api, "Mum", "+46 70 123 45 67");

      await seedTelegramUpdates(api, [
        { chat: { id: 555000444, type: "private", first_name: "Mum" }, contact: { phone_number: "+46701234567", first_name: "Mum" } },
      ]);
      expect((await api.post("/api/telegram/poll")).status()).toBe(200);

      expect((await telegramSettings(api)).telegram.recipients[0].chat_id).toBe("555000444");
    });

    test("a start that matches nobody is recorded rather than dropped", async ({ api }) => {
      await seedTelegramChats(api, [{ id: 555000555, type: "private", first_name: "Stranger" }]);
      expect((await api.post("/api/telegram/poll")).status()).toBe(200);

      const { telegram } = await telegramSettings(api);
      expect(telegram.recipients).toHaveLength(0);
      expect(telegram.detected.some(c => c.chat_id === "555000555")).toBeTruthy();
    });

    test("polling twice does not rebind or duplicate, since updates are consumed", async ({ api }) => {
      await link(api, "Alvita", "@alvita", { id: 555000666, type: "private", first_name: "A", username: "alvita" });

      const second = await api.post("/api/telegram/poll");
      expect(second.status()).toBe(200);
      expect((await second.json()).bound).toBe(0);

      expect((await telegramSettings(api)).telegram.recipients).toHaveLength(1);
    });

    test("a token another app drives explains itself instead of relaying Telegram", async ({ api }) => {
      await telegramWebhookActive(api);

      const response = await api.post("/api/telegram/poll");
      expect(response.status()).toBe(409);

      const { error } = await response.json();
      expect(error).toContain(TEST_BOT_USERNAME);
      expect(error).toMatch(/separate bot|numeric chat ID/i);
      expect(error).toMatch(/do not delete that webhook/i);
      expect(error).not.toMatch(/use deleteWebhook to delete/i);
    });
  });

  test.describe("delivery", () => {
    test("a reminder reaches every linked person", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "555000777");
      await api.put("/api/notify-settings", { data: { channel: "telegram" } });

      const id = await addReminderViaApi(api, "Dentist", 30);
      expect((await api.post(`/api/reminders/${id}/fire`)).status()).toBe(200);

      const messages = await telegramMessages(api);
      expect(messages).toHaveLength(2);
      expect(messages.map(m => m.chat_id).sort()).toEqual([CHAT_ID, "555000777"].sort());
      expect(messages.every(m => m.text.includes("Dentist"))).toBeTruthy();
      expect(await stubPushes(api)).toHaveLength(0);
    });

    test("someone still pending is skipped, not attempted", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "@alvita"); // invited, never started the bot
      await api.put("/api/notify-settings", { data: { channel: "telegram" } });

      expect((await api.post("/api/notify", { data: { message: "Only the linked one" } })).status()).toBe(200);
      expect(await telegramMessages(api)).toHaveLength(1);
    });

    test("the last selected person cannot be unselected", async ({ api }) => {
      const meId = await addRecipient(api, "Me", CHAT_ID);

      const response = await api.patch(`/api/telegram/recipients/${meId}`, { data: { enabled: false } });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/at least one person/i);

      // Still selected, so Telegram cannot end up reaching nobody.
      expect((await telegramSettings(api)).telegram.recipients[0].enabled).toBe(1);
    });

    test("unselecting is allowed while somebody else is still selected", async ({ api }) => {
      const meId = await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "555001300");

      expect((await api.patch(`/api/telegram/recipients/${meId}`, { data: { enabled: false } })).status()).toBe(200);

      // ...and now Alvita is the last one, so she is pinned in turn.
      const { telegram } = await telegramSettings(api);
      const alvita = telegram.recipients.find(r => r.name === "Alvita")!;
      expect((await api.patch(`/api/telegram/recipients/${alvita.id}`, { data: { enabled: false } })).status()).toBe(400);
    });

    test("a person who is pending does not count as selected", async ({ api }) => {
      const meId = await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "@alvita"); // invited, never linked

      // Alvita cannot receive anything, so unselecting Me would empty it.
      const response = await api.patch(`/api/telegram/recipients/${meId}`, { data: { enabled: false } });
      expect(response.status()).toBe(400);
    });

    test("a disabled person is skipped without being deleted", async ({ api }) => {
      const meId = await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "555000888"); // the one that stays selected
      await api.put("/api/notify-settings", { data: { channel: "telegram" } });

      expect((await api.patch(`/api/telegram/recipients/${meId}`, { data: { enabled: false } })).status()).toBe(200);
      expect((await api.post("/api/notify", { data: { message: "Just Alvita" } })).status()).toBe(200);

      const messages = await telegramMessages(api);
      expect(messages).toHaveLength(1);
      expect(messages[0].chat_id).toBe("555000888");
      // Still on the list, just switched off.
      expect((await telegramSettings(api)).telegram.recipients).toHaveLength(2);
    });

    test("one person failing does not stop the others", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "555000999");
      await api.put("/api/notify-settings", { data: { channel: "telegram" } });
      await telegramFailNext(api, 1);

      const response = await api.post("/api/notify", { data: { message: "Half delivered" } });
      expect(response.status()).toBe(200);
      expect(await telegramMessages(api)).toHaveLength(1);
    });

    test("the cron delivers to everyone", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "555001000");
      await api.put("/api/notify-settings", { data: { channel: "telegram" } });
      await addReminderViaApi(api, "Standup", -1);

      expect((await api.get(SCHEDULED_URL)).status()).toBe(200);

      const messages = await telegramMessages(api);
      expect(messages.filter(m => m.text.includes("Standup"))).toHaveLength(2);
    });

    test("on Both, ntfy gets one and each person gets one", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);
      await addRecipient(api, "Alvita", "555001100");
      await api.put("/api/notify-settings", { data: { channel: "both" } });

      const id = await addReminderViaApi(api, "Dentist", 30);
      expect((await api.post(`/api/reminders/${id}/fire`)).status()).toBe(200);

      expect(await stubPushes(api)).toHaveLength(1);
      expect(await telegramMessages(api)).toHaveLength(2);
    });

    test("HTML in a title is escaped, not interpreted", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);
      await api.put("/api/notify-settings", { data: { channel: "telegram" } });

      expect((await api.post("/api/notify", { data: { message: "<b>bold</b> & <i>x</i>" } })).status()).toBe(200);
      expect((await telegramMessages(api))[0].text).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; &lt;i&gt;x&lt;/i&gt;");
    });
  });

  test.describe("guard rails", () => {
    test("switching to Telegram with nobody linked is refused", async ({ api }) => {
      await addRecipient(api, "Alvita", "@alvita"); // invited only

      const response = await api.put("/api/notify-settings", { data: { channel: "telegram" } });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/start the bot/i);
      expect((await telegramSettings(api)).channel).toBe("ntfy");
    });

    test("an unknown channel is refused", async ({ api }) => {
      expect((await api.put("/api/notify-settings", { data: { channel: "carrier-pigeon" } })).status()).toBe(400);
    });

    // The button sits directly under the channel dropdown, so it must never
    // contradict it — sending to Telegram while it reads "ntfy only" is a bug.
    test.describe("the test message follows the channel", () => {
      test("ntfy only goes to ntfy and nowhere else", async ({ api }) => {
        await addRecipient(api, "Me", CHAT_ID);
        await api.put("/api/notify-settings", { data: { channel: "ntfy" } });

        expect((await api.post("/api/notify/test", { data: {} })).status()).toBe(200);

        expect(await stubPushes(api)).toHaveLength(1);
        expect(await telegramMessages(api)).toHaveLength(0);
      });

      test("Telegram only goes to Telegram and nowhere else", async ({ api }) => {
        await addRecipient(api, "Me", CHAT_ID);
        await api.put("/api/notify-settings", { data: { channel: "telegram" } });

        expect((await api.post("/api/notify/test", { data: {} })).status()).toBe(200);

        expect(await telegramMessages(api)).toHaveLength(1);
        expect(await stubPushes(api)).toHaveLength(0);
      });

      test("Both goes to ntfy and to every linked person", async ({ api }) => {
        await addRecipient(api, "Me", CHAT_ID);
        await addRecipient(api, "Alvita", "555002000");
        await api.put("/api/notify-settings", { data: { channel: "both" } });

        expect((await api.post("/api/notify/test", { data: {} })).status()).toBe(200);

        expect(await stubPushes(api)).toHaveLength(1);
        expect(await telegramMessages(api)).toHaveLength(2);
      });

      test("an unsaved selection is honoured, so the button matches the dropdown", async ({ api }) => {
        await addRecipient(api, "Me", CHAT_ID);
        // Saved channel is still ntfy; the dialog asks for telegram.
        expect((await api.post("/api/notify/test", { data: { channel: "telegram" } })).status()).toBe(200);

        expect(await telegramMessages(api)).toHaveLength(1);
        expect(await stubPushes(api)).toHaveLength(0);
        // ...and testing did not quietly change what is saved.
        expect((await telegramSettings(api)).channel).toBe("ntfy");
      });

      test("an unknown channel override is refused", async ({ api }) => {
        expect((await api.post("/api/notify/test", { data: { channel: "smoke-signal" } })).status()).toBe(400);
      });
    });

    test("the per-person test goes to Telegram whatever the channel is set to", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);

      // Channel is ntfy, but checking a person is about Telegram specifically.
      const response = await api.post("/api/telegram/test", { data: {} });
      expect(response.status(), await response.text()).toBe(200);

      expect(await telegramMessages(api)).toHaveLength(1);
      expect(await stubPushes(api)).toHaveLength(0);
    });

    test("the test message can target one person", async ({ api }) => {
      await addRecipient(api, "Me", CHAT_ID);
      const alvita = await addRecipient(api, "Alvita", "555001200");

      expect((await api.post("/api/telegram/test", { data: { id: alvita } })).status()).toBe(200);

      const messages = await telegramMessages(api);
      expect(messages).toHaveLength(1);
      expect(messages[0].chat_id).toBe("555001200");
    });

    test("testing with nobody linked says so", async ({ api }) => {
      const response = await api.post("/api/telegram/test", { data: {} });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toMatch(/nobody is linked/i);
    });

    test("removing someone stops their messages", async ({ api }) => {
      const meId = await addRecipient(api, "Me", CHAT_ID);
      await api.put("/api/notify-settings", { data: { channel: "telegram" } });

      expect((await api.delete(`/api/telegram/recipients/${meId}`)).status()).toBe(200);

      // Nobody left, so the send fails rather than quietly reaching no one.
      const response = await api.post("/api/notify", { data: { message: "into the void" } });
      expect(response.status()).toBe(502);
      expect(await telegramMessages(api)).toHaveLength(0);
    });
  });
});
