/**
 * Stands in for the real ntfy server during tests, so notification delivery is
 * actually asserted rather than assumed. The Worker is pointed here with
 * `--var NTFY_SERVER:...`.
 *
 * POST /<topic>   records the push and replies 200, mimicking ntfy
 * GET  /__pushes  returns everything recorded so far
 * DELETE /__pushes clears the log (called between tests)
 * POST /__fail    makes the next N pushes reply 429, to exercise error paths
 */
import { createServer } from "node:http";

const PORT = Number(process.env.NTFY_STUB_PORT || 8799);

const pushes = [];
let failuresRemaining = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/__pushes") {
    if (req.method === "GET") return json(200, { pushes });
    if (req.method === "DELETE") {
      pushes.length = 0;
      failuresRemaining = 0;
      return json(200, { ok: true });
    }
  }

  if (url.pathname === "/__fail" && req.method === "POST") {
    let body = "";
    req.on("data", c => (body += c));
    return req.on("end", () => {
      failuresRemaining = Number(JSON.parse(body || "{}").count ?? 1);
      json(200, { ok: true, failuresRemaining });
    });
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", c => (body += c));
    return req.on("end", () => {
      if (failuresRemaining > 0) {
        failuresRemaining--;
        return json(429, { code: 429, error: "stubbed daily limit reached" });
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { raw: body };
      }
      pushes.push({ topic: url.pathname.replace(/^\//, ""), at: Date.now(), body: parsed });
      json(200, { id: `stub-${pushes.length}` });
    });
  }

  json(404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ntfy-stub] listening on http://127.0.0.1:${PORT}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
