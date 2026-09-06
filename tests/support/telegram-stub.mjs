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
 * POST   /__updates   seeds the chats getUpdates will report
 */
import { createServer } from "node:http";

const PORT = Number(process.env.TELEGRAM_STUB_PORT || 8800);
export const BOT_USERNAME = "events_test_bot";

const messages = [];
let updates = [];
let failuresRemaining = 0;

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
      return json(200, { ok: true });
    }
  }

  if (url.pathname === "/__fail" && req.method === "POST") {
    failuresRemaining = Number((await readBody(req)).count ?? 1);
    return json(200, { ok: true, failuresRemaining });
  }

  if (url.pathname === "/__updates" && req.method === "POST") {
    const chats = (await readBody(req)).chats ?? [];
    updates = chats.map((chat, i) => ({ update_id: i + 1, message: { message_id: i + 1, chat, text: "/start" } }));
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
    if (method === "getUpdates") return json(200, { ok: true, result: updates });

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
