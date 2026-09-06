/**
 * Stands in for api.telegram.org during tests, so Telegram delivery is
 * asserted rather than assumed — the same trick ntfy-stub.mjs plays for ntfy.
 * The Worker is pointed here with `--var TELEGRAM_API_BASE:...`.
 *
 * /bot<token>/sendMessage  records the message and replies ok
 * /bot<token>/getMe        replies with a fixed bot identity
 * /bot<token>/getUpdates   replies with whatever __updates was seeded with
 *
 * GET    /__messages  everything sendMessage has recorded
 * DELETE /__messages  clears the log, the seeded updates and any pending failure
 * POST   /__fail      makes the next N sendMessage calls reply like Telegram does
 * POST   /__updates   queues updates for getUpdates to deliver: {chats:[...]}
 *                     for plain /start, or {updates:[...]} for raw ones
 *                     (deep-link payloads, shared contacts)
 * POST   /__webhook   pretends a webhook is registered, so getUpdates 409s
 *                     the way it does when another app is driving the bot
 */
import { createServer } from "node:http";

const PORT = Number(process.env.TELEGRAM_STUB_PORT || 8800);
export const BOT_USERNAME = "events_test_bot";

const messages = [];
let updates = [];
// Real update_ids only ever increase, and the Worker persists its getUpdates
// cursor in D1 — which outlives this process, since it sits in the test
// --persist-to directory. Counting from 1 on each stub start would put new
// updates *below* a cursor stored by an earlier run, where they are correctly
// ignored and every linking spec fails for a reason that is not the app's.
// Seeding from the clock keeps ids ahead of anything previously acknowledged.
let nextUpdateId = Math.floor(Date.now() / 1000);
let failuresRemaining = 0;
let webhookActive = false;

const readBody = req =>
  new Promise(resolve => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({ raw });
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/__messages") {
    if (req.method === "GET") return json(200, { messages });
    if (req.method === "DELETE") {
      messages.length = 0;
      updates = [];
      failuresRemaining = 0;
      webhookActive = false;
      return json(200, { ok: true });
    }
  }

  if (url.pathname === "/__fail" && req.method === "POST") {
    failuresRemaining = Number((await readBody(req)).count ?? 1);
    return json(200, { ok: true, failuresRemaining });
  }

  if (url.pathname === "/__webhook" && req.method === "POST") {
    webhookActive = (await readBody(req)).active !== false;
    return json(200, { ok: true, webhookActive });
  }

  if (url.pathname === "/__updates" && req.method === "POST") {
    const body = await readBody(req);
    if (body.updates) {
      // Raw updates, for deep-link payloads and shared contacts.
      for (const u of body.updates) updates.push({ update_id: nextUpdateId++, message: { message_id: nextUpdateId, ...u } });
    } else {
      for (const chat of body.chats ?? []) updates.push({ update_id: nextUpdateId++, message: { message_id: nextUpdateId, chat, text: "/start" } });
    }
    return json(200, { ok: true, count: updates.length });
  }

  // Everything else is the Bot API itself: /bot<token>/<method>.
  const call = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (call && req.method === "POST") {
    const [, token, method] = call;
    // The real API 404s an unknown token, and a stub that accepted anything
    // would let a broken-token bug through.
    if (!token || token === "undefined") return json(404, { ok: false, description: "Not Found" });

    const payload = await readBody(req);

    if (method === "getMe") return json(200, { ok: true, result: { id: 42, is_bot: true, username: BOT_USERNAME, first_name: "Events" } });
    if (method === "getUpdates") {
      // Telegram's actual response when the bot has a webhook registered.
      if (webhookActive) {
        return json(409, {
          ok: false,
          error_code: 409,
          description: "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
        });
      }
      // Real getUpdates *consumes*: an offset acknowledges everything below it
      // and those updates are never returned again. The poller depends on that,
      // so the stub has to honour it rather than replaying the same list.
      const offset = Number(payload.offset || 0);
      if (offset) updates = updates.filter(u => u.update_id >= offset);
      return json(200, { ok: true, result: updates });
    }

    if (method === "sendMessage") {
      if (failuresRemaining > 0) {
        failuresRemaining--;
        return json(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" });
      }
      messages.push({ at: Date.now(), chat_id: String(payload.chat_id ?? ""), text: String(payload.text ?? "") });
      return json(200, { ok: true, result: { message_id: messages.length, chat: { id: payload.chat_id } } });
    }

    return json(404, { ok: false, description: `Unsupported method ${method}` });
  }

  json(404, { ok: false, description: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[telegram-stub] listening on http://127.0.0.1:${PORT}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
