
// ---------------------------------------------------------------------------
// Time helpers. Everything the user sees is wall-clock time in TZ_NAME;
// everything we schedule on is a unix epoch. These convert between the two.
// ---------------------------------------------------------------------------

function tzOffsetSeconds(utcMs, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour % 24,
    +parts.minute,
    +parts.second,
  );
  return (asUTC - utcMs) / 1000;
}

// "2026-09-10" + "13:00" in Europe/Stockholm -> unix seconds.
// Two passes so DST transition days resolve correctly.
function localToEpoch(dateStr, timeStr, tz) {
  const naiveMs = Date.parse(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naiveMs)) return null;
  let guess = naiveMs - tzOffsetSeconds(naiveMs, tz) * 1000;
  guess = naiveMs - tzOffsetSeconds(guess, tz) * 1000;
  return Math.floor(guess / 1000);
}

function epochToUTCStamp(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Session: an HMAC-signed expiry stamp in an HttpOnly cookie. No server state,
// no D1 round trip per request. Rotating SESSION_SECRET logs every device out.
// ---------------------------------------------------------------------------

const SESSION_DAYS = 30;

async function issueSession(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const sig = await hmac(String(exp), env.SESSION_SECRET);
  const value = `${exp}.${sig}`;
  return `sid=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

// A capability, separate from the session: holding a session lets you read and
// edit, holding this as well lets you delete. Short-lived on purpose.
const SUPERUSER_MINUTES = 60;

async function issueSuperuser(env) {
  const exp = Math.floor(Date.now() / 1000) + SUPERUSER_MINUTES * 60;
  const sig = await hmac(`su:${exp}`, env.SESSION_SECRET);
  return `su=${exp}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SUPERUSER_MINUTES * 60}`;
}

const CLEAR_SUPERUSER = "su=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";

async function hasSuperuser(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)su=([^;]+)/);
  if (!match) return false;
  const [exp, sig] = match[1].split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(sig, await hmac(`su:${exp}`, env.SESSION_SECRET));
}

async function hasSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!match) return false;
  const [exp, sig] = match[1].split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(sig, await hmac(exp, env.SESSION_SECRET));
}

// ---------------------------------------------------------------------------
// Login throttling
// ---------------------------------------------------------------------------

// Overridable so the test suite, which deliberately submits wrong patterns,
// does not lock its own IP out for a quarter of an hour. Production sets
// neither and gets these defaults.
const MAX_FAILS = 5;
const LOCKOUT_SECONDS = 900;

const maxFails = (env) => Number(env.MAX_LOGIN_FAILS) || MAX_FAILS;
const lockoutSeconds = (env) => Number(env.LOGIN_LOCKOUT_SECONDS) || LOCKOUT_SECONDS;

async function checkLockout(env, ip) {
  const row = await env.DB.prepare(`SELECT fails, locked_until FROM auth_attempts WHERE ip = ?`)
    .bind(ip)
    .first();
  const now = Math.floor(Date.now() / 1000);
  if (row?.locked_until && row.locked_until > now) return row.locked_until - now;
  return 0;
}

async function recordFailure(env, ip) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO auth_attempts (ip, fails, locked_until) VALUES (?1, 1, NULL)
     ON CONFLICT(ip) DO UPDATE SET
       fails = auth_attempts.fails + 1,
       locked_until = CASE WHEN auth_attempts.fails + 1 >= ?2 THEN ?3 ELSE auth_attempts.locked_until END`,
  )
    .bind(ip, maxFails(env), now + lockoutSeconds(env))
    .run();
}

async function clearFailures(env, ip) {
  await env.DB.prepare(`DELETE FROM auth_attempts WHERE ip = ?`).bind(ip).run();
}

// ---------------------------------------------------------------------------
// Validation. Everything crossing the trust boundary is checked here, including
// events arriving from an .ics file the user picked — a file is not a promise.
// ---------------------------------------------------------------------------

const PALETTE = [
  "#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#9333ea", "#ea580c", "#525252",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function randomColor() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

/**
 * Coerces the several shapes a boolean arrives in — the editor posts 1/0, the
 * importer posts true/false, and a hand-rolled request might send "0" — to an
 * actual boolean, falling back when the field is absent altogether.
 */
function toBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !["", "0", "false", "no"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function clean(value, max) {
  if (typeof value !== "string") return null;
  // Strip control characters; they break ICS output and serve no purpose here.
  const stripped = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return stripped ? stripped.slice(0, max) : null;
}

function validateEvent(input, tz) {
  const errors = [];

  const title = clean(input.title, 200);
  if (!title) errors.push("Title is required.");

  const startDate = typeof input.start_date === "string" && DATE_RE.test(input.start_date)
    ? input.start_date : null;
  if (!startDate) errors.push("Start date must look like 2026-09-10.");

  let endDate = typeof input.end_date === "string" && DATE_RE.test(input.end_date)
    ? input.end_date : startDate;
  if (startDate && endDate && endDate < startDate) errors.push("End date is before the start date.");

  // The editor sends 1/0 and the importer sends true/false, so this cannot
  // test for `false` alone — `0 !== false` is true, which silently turned
  // every timed event created in the UI into an all-day one. Absent still
  // means all-day, which is what the .ics importer relies on.
  const allDay = toBool(input.all_day, true);

  let startTime = null;
  let endTime = null;
  if (!allDay) {
    startTime = typeof input.start_time === "string" && TIME_RE.test(input.start_time)
      ? input.start_time : null;
    endTime = typeof input.end_time === "string" && TIME_RE.test(input.end_time)
      ? input.end_time : null;
    if (!startTime) errors.push("Start time must look like 09:30.");
    if (endTime && startDate === endDate && endTime < startTime) {
      errors.push("End time is before the start time.");
    }
  }

  // No colour picked is a normal case, not an error: assign one.
  const color = typeof input.color === "string" && COLOR_RE.test(input.color)
    ? input.color.toLowerCase() : randomColor();

  // Up to 5 fixed clock-time reminders, deduped and sorted for a stable,
  // predictable order in both the editor and the fired-in-order pushes.
  let reminderTimes = [];
  if (Array.isArray(input.reminder_times)) {
    if (input.reminder_times.length > 5) errors.push("Up to 5 reminder times.");
    else if (input.reminder_times.some((t) => typeof t !== "string" || !TIME_RE.test(t))) {
      errors.push("Reminder times must look like 09:00.");
    } else {
      reminderTimes = [...new Set(input.reminder_times)].sort();
    }
  }

  if (errors.length) return { errors };

  return {
    event: {
      title,
      notes: clean(input.notes, 2000),
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      all_day: allDay ? 1 : 0,
      color,
      uid: clean(input.uid, 300),
      repeat_yearly: toBool(input.repeat_yearly, false) ? 1 : 0,
      reminder_times: reminderTimes,
    },
  };
}

// Returns {ok, reason} rather than a bare boolean so a failure can actually
// say why — "it didn't work" was useless for tracking down the real cause.
async function pushNtfy(env, body) {
  const server = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
  const topic = env.NTFY_TOPIC || "";
  if (!topic) return { ok: false, reason: "NTFY_TOPIC is not set." };
  if (topic !== topic.trim()) return { ok: false, reason: "NTFY_TOPIC has stray leading/trailing whitespace." };
  try {
    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: "Coming up",
        Priority: "4",
        Tags: "calendar",
        "Content-Type": "text/plain; charset=utf-8",
      },
      body,
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `ntfy responded ${res.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err?.message || err}` };
  }
}

// ---------------------------------------------------------------------------
// Telegram. A second delivery channel alongside ntfy, using the Bot API
// directly — no webhook, because this bot only ever speaks and never listens
// (nothing in the calendar is resolved from a notification).
// ---------------------------------------------------------------------------

// Telegram's HTML parse mode only reserves these three.
function tgEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Overridable so the test suite can point the client at a stub, exactly as
// NTFY_SERVER does for ntfy. Production never sets it.
function telegramApiBase(env) {
  return (env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
}

// Returns {ok, result} / {ok:false, reason} rather than throwing: a Telegram
// outage must not take down the endpoint that called it, and the reason is
// what ends up in reminders.last_error.
async function telegramCall(env, method, payload = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return { ok: false, reason: "TELEGRAM_BOT_TOKEN is not set." };
  if (token !== token.trim()) return { ok: false, reason: "TELEGRAM_BOT_TOKEN has stray leading/trailing whitespace." };
  try {
    const res = await fetch(`${telegramApiBase(env)}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { ok: true, result: data.result };
    const why = String(data?.description || `HTTP ${res.status}`).slice(0, 200);
    return { ok: false, reason: `Telegram ${method} failed: ${why}` };
  } catch (err) {
    return { ok: false, reason: `Telegram ${method} failed: ${err?.message || err}` };
  }
}

async function pushTelegram(env, chatId, title, body) {
  if (!chatId) return { ok: false, reason: "No Telegram chat is linked yet." };
  return telegramCall(env, "sendMessage", {
    chat_id: chatId,
    text: `<b>${tgEscape(title)}</b>\n${tgEscape(body)}`,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

// ---------------------------------------------------------------------------
// Which channel(s) a reminder goes to. This is a preference rather than a
// credential, so it lives in the database and is switchable from the app —
// the point being that when one channel is having a bad day (a sleeping
// self-hosted ntfy, a revoked bot token) reminders can be moved to the other
// without a deploy.
// ---------------------------------------------------------------------------

const NOTIFY_CHANNELS = ["ntfy", "telegram", "both"];
const DEFAULT_SETTINGS = { notify_channel: "ntfy", telegram_chat_id: "" };

async function getSettings(env) {
  try {
    const { results } = await env.DB.prepare(`SELECT key, value FROM settings`).all();
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(results.map((r) => [r.key, r.value])) };
  } catch {
    // `settings` is newer than the rest of the schema and migrations are not
    // applied on deploy, so a database that has not had schema.sql re-run yet
    // keeps delivering to ntfy instead of failing every single reminder.
    return { ...DEFAULT_SETTINGS };
  }
}

// Sends one reminder to every configured channel. `settings` is passed in by
// the cron so a batch of due reminders costs one settings read, not fifty.
async function deliverPush(env, body, settings) {
  const s = settings || (await getSettings(env));
  const channel = NOTIFY_CHANNELS.includes(s.notify_channel) ? s.notify_channel : "ntfy";

  // Fired in parallel: on "both" the cron would otherwise pay two round trips
  // per reminder, and it works through up to fifty of them in one tick.
  const sending = [];
  if (channel === "ntfy" || channel === "both") {
    sending.push(pushNtfy(env, body).then((r) => ({ name: "ntfy", ...r })));
  }
  if (channel === "telegram" || channel === "both") {
    sending.push(pushTelegram(env, s.telegram_chat_id, "Coming up", body).then((r) => ({ name: "telegram", ...r })));
  }
  const attempts = await Promise.all(sending);

  // On "both", one arrival is success. A reminder that reached the phone has
  // done its job, and failing the delivery because the second channel is down
  // would only schedule a retry that re-sends on the channel that worked.
  if (attempts.some((a) => a.ok)) return { ok: true };
  return {
    ok: false,
    reason: attempts.map((a) => `${a.name}: ${a.reason}`).join("; ") || "No delivery channel is configured.",
  };
}

// One reminders-table row per configured time, targeting `occurrenceDate` —
// the event's own date for a one-off event, or its next occurrence for a
// repeat_yearly one (see nextYearlyOccurrence).
function dailyReminderInserts(env, eventId, occurrenceDate, times, tz) {
  return times
    .map((t) => localToEpoch(occurrenceDate, t, tz))
    .filter((at) => at !== null)
    .map((at) =>
      env.DB.prepare(`INSERT INTO reminders (id, event_id, notify_at) VALUES (?1,?2,?3)`)
        .bind(crypto.randomUUID(), eventId, at),
    );
}

// The month/day to repeat on, resolved to whichever of this year or next
// actually falls on or after today in `tz` — mirrors the client's identical
// helper used when staging a yearly-recurring import.
function nextYearlyOccurrence(monthDayFrom, tz) {
  const [, m, d] = monthDayFrom.split("-").map(Number);
  const todayParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const todayY = +todayParts.year, todayM = +todayParts.month, todayD = +todayParts.day;
  const year = m < todayM || (m === todayM && d < todayD) ? todayY + 1 : todayY;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// The "give me everything" range search uses. It has no natural lower bound of
// its own, so yearly events resolve to just their next upcoming occurrence
// rather than one row per year since 1970.
const SEARCH_FROM = "0000-01-01";
const SEARCH_TO = "9999-12-31";

// The span the calendar itself can reach — the year box accepts 1970-2200, so
// a yearly event must exist across all of it. A per-request span cap is what
// stops a caller asking for a thousand years, rather than a fixed horizon that
// made birthdays silently vanish after a certain year.
const MIN_EXPAND_YEAR = 1970;
const MAX_EXPAND_YEAR = 2200;
const MAX_YEARS_PER_REQUEST = 200;

// Expands a repeat_yearly event's stored anchor date (which may be its true,
// long-past origin date — a birthday's DTSTART from years ago) into every
// occurrence that falls inside [from, to]. Returning *all* of them matters:
// the calendar fetches a multi-year window, and returning only one occurrence
// meant a birthday vanished as soon as you paged into the next year.
function yearlyOccurrencesInRange(event, from, to) {
  const spanDays = Math.round(
    (Date.parse(event.end_date + "T12:00:00Z") - Date.parse(event.start_date + "T12:00:00Z")) / 86400000,
  );
  const [, month, day] = event.start_date.split("-").map(Number);
  const nowYear = new Date().getUTCFullYear();

  // Detected exactly, not inferred from the span — a legitimate three-year
  // calendar window used to be mistaken for a search and collapsed to one row.
  const isSearch = from === SEARCH_FROM && to === SEARCH_TO;
  const todayStr = new Date().toISOString().slice(0, 10);
  const effectiveFrom = isSearch ? todayStr : from;

  const fromYear = Math.max(+effectiveFrom.slice(0, 4), MIN_EXPAND_YEAR);
  const requestedTo = isSearch ? nowYear + 5 : +to.slice(0, 4);
  const toYear = Math.min(requestedTo, MAX_EXPAND_YEAR, fromYear + MAX_YEARS_PER_REQUEST);

  const out = [];
  for (let y = fromYear; y <= toYear; y++) {
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCMonth() !== month - 1) continue; // Feb 29 in a non-leap year — no occurrence that year
    const candStart = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + spanDays);
    const candEnd = d.toISOString().slice(0, 10);
    if (candEnd < effectiveFrom || candStart > to) continue;

    // occurrence_year lets the client key each occurrence separately while
    // still knowing the real row id for edits and deletes.
    out.push({ ...event, start_date: candStart, end_date: candEnd, occurrence_year: y });
    if (isSearch) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// ICS output for the read-only subscription feed
// ---------------------------------------------------------------------------

function icsEscape(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function fold(line) {
  if (line.length <= 73) return line;
  const chunks = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    chunks.push(" " + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest) chunks.push(" " + rest);
  return chunks.join("\r\n");
}

function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildICS(rows, tz) {
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//colaco.se//events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:colaco events",
  ];
  const stamp = epochToUTCStamp(Math.floor(Date.now() / 1000));

  for (const r of rows) {
    out.push("BEGIN:VEVENT");
    out.push(`UID:${r.uid || r.id}@events.colaco.se`);
    out.push(`DTSTAMP:${stamp}`);
    if (r.all_day) {
      out.push(`DTSTART;VALUE=DATE:${r.start_date.replace(/-/g, "")}`);
      // DTEND is exclusive for date values, so push it one day past the last day.
      out.push(`DTEND;VALUE=DATE:${nextDay(r.end_date).replace(/-/g, "")}`);
    } else {
      const s = localToEpoch(r.start_date, r.start_time, tz);
      const e = localToEpoch(r.end_date, r.end_time || r.start_time, tz);
      out.push(`DTSTART:${epochToUTCStamp(s)}`);
      out.push(`DTEND:${epochToUTCStamp(e > s ? e : s + 3600)}`);
    }
    if (r.repeat_yearly) out.push("RRULE:FREQ=YEARLY");
    out.push(fold(`SUMMARY:${icsEscape(r.title)}`));
    if (r.notes) out.push(fold(`DESCRIPTION:${icsEscape(r.notes)}`));
    out.push(`X-APPLE-CALENDAR-COLOR:${r.color}`);
    // Reminders fire as ntfy pushes at their own fixed clock times, not as
    // a single before-start offset — no clean VALARM equivalent, so the
    // subscribed .ics feed is for viewing the calendar, not for alarms.
    out.push("END:VEVENT");
  }

  out.push("END:VCALENDAR");
  return out.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Remote .ics fetch. This is the one place the Worker will fetch a URL the user
// supplies, so it is deliberately narrow: https only, no IP literals, no
// redirects to somewhere else, hard size cap.
// ---------------------------------------------------------------------------

const BLOCKED_HOSTS = /^(localhost|.*\.local|.*\.internal|metadata\..*)$/i;
const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$|^\[?[0-9a-f:]+\]?$/i;
const MAX_ICS_BYTES = 4 * 1024 * 1024;

async function fetchRemoteICS(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).replace(/^webcal:/i, "https:"));
  } catch {
    return { error: "That does not look like a URL." };
  }
  if (url.protocol !== "https:") return { error: "Only https:// and webcal:// links are allowed." };
  if (url.username || url.password) return { error: "Remove the username and password from the URL." };
  if (BLOCKED_HOSTS.test(url.hostname) || IP_LITERAL.test(url.hostname)) {
    return { error: "That host is not allowed." };
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "text/calendar, text/plain" },
    });
  } catch {
    return { error: "Could not reach that URL." };
  }
  if (!res.ok) return { error: `The calendar server returned ${res.status}.` };

  const size = Number(res.headers.get("Content-Length") || 0);
  if (size > MAX_ICS_BYTES) return { error: "That calendar file is too large." };

  const text = (await res.text()).slice(0, MAX_ICS_BYTES);
  if (!text.includes("BEGIN:VCALENDAR")) return { error: "That URL did not return a calendar file." };
  return { text };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });

// The CSP and frame/referrer headers for the app shell now live in
// webapp/public/_headers, which Workers Static Assets applies to the built
// pages the Worker no longer serves itself.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const tz = env.TZ_NAME || "Europe/Stockholm";

    // Read-only subscription feed. The token in the path is the credential,
    // because iOS cannot send an auth header on a calendar subscription.
    if (path.startsWith("/feed/") && path.endsWith(".ics")) {
      const token = path.slice(6, -4);
      if (!env.FEED_TOKEN || !timingSafeEqual(token, env.FEED_TOKEN)) {
        return new Response("Not found", { status: 404 });
      }
      const { results } = await env.DB.prepare(
        `SELECT * FROM events ORDER BY start_date`,
      ).all();
      return new Response(buildICS(results, tz), {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Robots-Tag": "noindex",
        },
      });
    }

    if (path === "/api/login" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const wait = await checkLockout(env, ip);
      if (wait > 0) {
        return json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` }, 429);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }
      const pattern = typeof body.pattern === "string" ? body.pattern.slice(0, 9) : "";
      const candidate = await sha256Hex(`${pattern}:${env.AUTH_PEPPER}`);
      if (!timingSafeEqual(candidate, env.PATTERN_HASH)) {
        await recordFailure(env, ip);
        return json({ error: "That pattern is not right." }, 401);
      }
      await clearFailures(env, ip);
      return json({ ok: true }, 200, { "Set-Cookie": await issueSession(env) });
    }

    if (path === "/api/logout" && request.method === "POST") {
      return json({ ok: true }, 200, {
        "Set-Cookie": "sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
      });
    }

    // Everything below requires a session.
    if (!(await hasSession(request, env))) {
      return json({ error: "Locked" }, 401);
    }

    // Turning deleting on. The phrase is never shipped to the browser: only
    // its hash is stored, and only as a Cloudflare secret, so the client has
    // nothing to leak. Brute force is throttled the same way login is.
    if (path === "/api/superuser" && request.method === "POST") {
      if (!env.SUPERUSER_HASH) return json({ error: "Superuser is not configured on this deployment." }, 501);

      const ip = `su:${request.headers.get("CF-Connecting-IP") || "unknown"}`;
      const wait = await checkLockout(env, ip);
      if (wait) return json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` }, 429);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }

      const candidate = await sha256Hex(`${body.phrase}:${env.AUTH_PEPPER}`);
      if (!timingSafeEqual(candidate, env.SUPERUSER_HASH)) {
        await recordFailure(env, ip);
        return json({ error: "That superuser passphrase is not right." }, 401);
      }

      await clearFailures(env, ip);
      return json({ ok: true }, 200, { "Set-Cookie": await issueSuperuser(env) });
    }

    if (path === "/api/superuser" && request.method === "DELETE") {
      return json({ ok: true }, 200, { "Set-Cookie": CLEAR_SUPERUSER });
    }

    if (path === "/api/superuser" && request.method === "GET") {
      return json({ enabled: await hasSuperuser(request, env) });
    }

    if (path === "/api/events" && request.method === "GET") {
      const from = DATE_RE.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : "0000-01-01";
      const to = DATE_RE.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : "9999-12-31";
      const { results: plain } = await env.DB.prepare(
        `SELECT * FROM events WHERE repeat_yearly = 0 AND end_date >= ? AND start_date <= ?`,
      )
        .bind(from, to)
        .all();
      const { results: yearly } = await env.DB.prepare(`SELECT * FROM events WHERE repeat_yearly = 1`).all();
      const expanded = yearly.flatMap((e) => yearlyOccurrencesInRange(e, from, to));
      const events = [...plain, ...expanded].sort(
        (a, b) => a.start_date.localeCompare(b.start_date)
          || b.all_day - a.all_day
          || (a.start_time || "").localeCompare(b.start_time || ""),
      );
      return json({ events });
    }

    if (path === "/api/events" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }
      const { event, errors } = validateEvent(body, tz);
      if (errors) return json({ error: errors.join(" ") }, 400);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO events (id, uid, title, notes, start_date, end_date, start_time, end_time,
                             all_day, color, created_at, repeat_yearly, reminder_times)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`,
      )
        .bind(
          id, event.uid, event.title, event.notes, event.start_date, event.end_date,
          event.start_time, event.end_time, event.all_day, event.color,
          Math.floor(Date.now() / 1000), event.repeat_yearly, JSON.stringify(event.reminder_times),
        )
        .run();
      if (event.reminder_times.length) {
        const occurrence = event.repeat_yearly ? nextYearlyOccurrence(event.start_date, tz) : event.start_date;
        const inserts = dailyReminderInserts(env, id, occurrence, event.reminder_times, tz);
        if (inserts.length) await env.DB.batch(inserts);
      }
      return json({ id });
    }

    const eventMatch = path.match(/^\/api\/events\/([0-9a-f-]{36})$/);
    if (eventMatch && request.method === "DELETE") {
      // Deleting needs the capability, not just a session. Enforced here
      // rather than in the UI so hiding the button is not the only thing
      // standing between a stray tap and a lost event.
      if (!(await hasSuperuser(request, env))) {
        return json({ error: "Deleting is switched off. Enable superuser first." }, 403);
      }
      await env.DB.prepare(`DELETE FROM reminders WHERE event_id = ?`).bind(eventMatch[1]).run();
      await env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(eventMatch[1]).run();
      return json({ ok: true });
    }

    if (eventMatch && request.method === "PATCH") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }
      const { event, errors } = validateEvent(body, tz);
      if (errors) return json({ error: errors.join(" ") }, 400);

      // Renaming needs the capability, the same as deleting. Everything else
      // about an event stays freely editable — it is the identity of the entry
      // that is protected, so a stray edit cannot quietly retitle something.
      const existing = await env.DB.prepare(`SELECT title FROM events WHERE id = ?`).bind(eventMatch[1]).first();
      if (existing && existing.title !== event.title && !(await hasSuperuser(request, env))) {
        return json({ error: "Renaming an event needs superuser. Enable it first." }, 403);
      }

      await env.DB.prepare(
        `UPDATE events SET title=?1, notes=?2, start_date=?3, end_date=?4, start_time=?5,
           end_time=?6, all_day=?7, color=?8, repeat_yearly=?9, reminder_times=?10
         WHERE id=?11`,
      )
        .bind(
          event.title, event.notes, event.start_date, event.end_date, event.start_time,
          event.end_time, event.all_day, event.color,
          event.repeat_yearly, JSON.stringify(event.reminder_times), eventMatch[1],
        )
        .run();
      // Reminders are keyed to the event's current date (or next occurrence,
      // for repeat_yearly) — refresh them so an edited date, a changed set
      // of times, or toggling "repeats yearly" itself never leaves a stale
      // or wrongly-timed reminder behind.
      await env.DB.prepare(`DELETE FROM reminders WHERE event_id = ?`).bind(eventMatch[1]).run();
      if (event.reminder_times.length) {
        const occurrence = event.repeat_yearly ? nextYearlyOccurrence(event.start_date, tz) : event.start_date;
        const inserts = dailyReminderInserts(env, eventMatch[1], occurrence, event.reminder_times, tz);
        if (inserts.length) await env.DB.batch(inserts);
      }
      return json({ ok: true });
    }

    if (path === "/api/import/fetch" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }
      const result = await fetchRemoteICS(body.url);
      if (result.error) return json({ error: result.error }, 400);
      return json({ text: result.text });
    }

    if (path === "/api/import" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }
      if (!Array.isArray(body.events)) return json({ error: "Nothing to import." }, 400);
      if (body.events.length > 1000) return json({ error: "Import 1000 events or fewer at a time." }, 400);

      const now = Math.floor(Date.now() / 1000);
      const rows = [];
      let rejected = 0;

      for (const raw of body.events) {
        const { event, errors } = validateEvent(raw, tz);
        if (errors) {
          rejected++;
          continue;
        }
        rows.push({ id: crypto.randomUUID(), event });
      }

      // Batched so a failure part-way through does not leave a half-done import.
      const eventStatements = rows.map(({ id, event }) =>
        env.DB.prepare(
          `INSERT INTO events (id, uid, title, notes, start_date, end_date, start_time, end_time,
                               all_day, color, created_at, repeat_yearly, reminder_times)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
           ON CONFLICT(uid) DO NOTHING`,
        ).bind(
          id, event.uid, event.title, event.notes, event.start_date,
          event.end_date, event.start_time, event.end_time, event.all_day, event.color,
          now, event.repeat_yearly, JSON.stringify(event.reminder_times),
        ),
      );
      const results = eventStatements.length ? await env.DB.batch(eventStatements) : [];

      // `ON CONFLICT DO NOTHING` means a duplicate uid silently no-ops rather
      // than erroring — meta.changes tells us which rows actually landed, so
      // an already-imported event doesn't also pick up a second set of
      // reminders.
      let imported = 0;
      const reminderStatements = [];
      results.forEach((r, i) => {
        if (r.meta.changes === 0) return;
        imported++;
        const { id, event } = rows[i];
        if (event.reminder_times.length) {
          const occurrence = event.repeat_yearly ? nextYearlyOccurrence(event.start_date, tz) : event.start_date;
          reminderStatements.push(...dailyReminderInserts(env, id, occurrence, event.reminder_times, tz));
        }
      });
      if (reminderStatements.length) await env.DB.batch(reminderStatements);

      return json({ imported, rejected });
    }

    if (path === "/api/feed-url" && request.method === "GET") {
      return json({ url: `https://${url.hostname}/feed/${env.FEED_TOKEN}.ics` });
    }

    if (path === "/api/ntfy-info" && request.method === "GET") {
      return json({
        server: (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, ""),
        topic: env.NTFY_TOPIC,
        topicHasStrayWhitespace: env.NTFY_TOPIC !== env.NTFY_TOPIC?.trim(),
      });
    }

    // -----------------------------------------------------------------------
    // Notification channel settings, and linking the Telegram chat.
    // -----------------------------------------------------------------------

    if (path === "/api/notify-settings" && request.method === "GET") {
      const s = await getSettings(env);
      // getMe both proves the token works and gives the @username to show, so
      // "is Telegram actually set up?" is answered by Telegram, not by guessing
      // from whether a secret happens to be non-empty.
      const me = env.TELEGRAM_BOT_TOKEN ? await telegramCall(env, "getMe") : { ok: false, reason: "TELEGRAM_BOT_TOKEN is not set." };
      return json({
        channel: NOTIFY_CHANNELS.includes(s.notify_channel) ? s.notify_channel : "ntfy",
        telegram: {
          tokenSet: Boolean(env.TELEGRAM_BOT_TOKEN),
          chatId: s.telegram_chat_id,
          bot: me.ok ? me.result?.username || null : null,
          error: me.ok ? null : me.reason,
        },
      });
    }

    if (path === "/api/notify-settings" && request.method === "PUT") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }

      const channel = clean(body.channel, 20);
      if (!NOTIFY_CHANNELS.includes(channel)) {
        return json({ error: "Channel must be ntfy, telegram or both." }, 400);
      }

      // Numeric for a private chat or group, @name for a channel. Anything
      // else is a typo, and a typo here silently stops reminders arriving.
      const chatId = clean(body.telegram_chat_id, 64) || "";
      if (chatId && !/^-?\d{1,20}$/.test(chatId) && !/^@[A-Za-z0-9_]{4,32}$/.test(chatId)) {
        return json({ error: "Chat ID must be a number, or @name for a channel." }, 400);
      }

      // Refuse to arm a channel that cannot deliver. Saving this and finding
      // out at 07:00 that the reminder went nowhere is the failure worth
      // designing against.
      if (channel !== "ntfy") {
        if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "Set the TELEGRAM_BOT_TOKEN secret first." }, 400);
        if (!chatId) return json({ error: "Link a Telegram chat first." }, 400);
      }

      await env.DB.batch([
        env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('notify_channel', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(channel),
        env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(chatId),
      ]);

      return json({ ok: true, channel, telegram_chat_id: chatId });
    }

    // A bot cannot message someone first, so the chat ID can only be learned
    // after the user has sent the bot something. getUpdates is enough for
    // that and needs no webhook, no public callback URL and no secret token —
    // the whole registration dance the task app needs is unnecessary here.
    if (path === "/api/telegram/discover" && request.method === "POST") {
      const updates = await telegramCall(env, "getUpdates", { limit: 100, allowed_updates: ["message"] });
      if (!updates.ok) return json({ error: updates.reason }, 502);

      const chats = new Map();
      for (const update of updates.result || []) {
        const chat = update.message?.chat || update.my_chat_member?.chat;
        if (!chat) continue;
        const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || String(chat.id);
        chats.set(String(chat.id), { id: String(chat.id), name, type: chat.type });
      }
      return json({ chats: [...chats.values()] });
    }

    // Proves the bot can actually reach the chat, before it is trusted with a
    // real reminder. Deliberately independent of the selected channel — you
    // want to test Telegram *before* switching reminders over to it.
    if (path === "/api/telegram/test" && request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        /* an empty body is fine — fall back to the saved chat */
      }
      const s = await getSettings(env);
      const chatId = clean(body.telegram_chat_id, 64) || s.telegram_chat_id;
      const push = await pushTelegram(env, chatId, "Coming up", "Test message from your calendar.");
      if (!push.ok) return json({ error: push.reason }, 502);
      return json({ ok: true });
    }

    if (path === "/api/upcoming" && request.method === "GET") {
      // Only what's actually due soon — a list padded out with birthdays a
      // year away isn't "upcoming notifications," it's just noise.
      const now = Math.floor(Date.now() / 1000);
      const { results } = await env.DB.prepare(
        `SELECT r.id, r.notify_at, r.attempts, e.title, e.all_day, e.start_time
         FROM reminders r JOIN events e ON e.id = r.event_id
         WHERE r.notified_at IS NULL AND r.notify_at <= ?
         ORDER BY r.notify_at ASC
         LIMIT 20`,
      )
        .bind(now + 48 * 3600)
        .all();
      return json({ upcoming: results });
    }

    const fireMatch = path.match(/^\/api\/reminders\/([0-9a-f-]{36})\/fire$/);
    if (fireMatch && request.method === "POST") {
      const rem = await env.DB.prepare(
        `SELECT e.title, e.start_time, e.all_day FROM reminders r JOIN events e ON e.id = r.event_id WHERE r.id = ?`,
      )
        .bind(fireMatch[1])
        .first();
      if (!rem) return json({ error: "Not found" }, 404);
      const push = await deliverPush(env, rem.all_day ? rem.title : `${rem.start_time} — ${rem.title}`);
      if (!push.ok) {
        await env.DB.prepare(`UPDATE reminders SET attempts = attempts + 1, last_error = ? WHERE id = ?`)
          .bind(push.reason, fireMatch[1])
          .run();
        return json({ error: push.reason }, 502);
      }
      await env.DB.prepare(`UPDATE reminders SET notified_at = ?, last_error = NULL WHERE id = ?`)
        .bind(Math.floor(Date.now() / 1000), fireMatch[1])
        .run();
      return json({ ok: true });
    }

    const cancelMatch = path.match(/^\/api\/reminders\/([0-9a-f-]{36})$/);
    if (cancelMatch && request.method === "DELETE") {
      await env.DB.prepare(`DELETE FROM reminders WHERE id = ?`).bind(cancelMatch[1]).run();
      return json({ ok: true });
    }

    if (path === "/api/notify" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Malformed request." }, 400);
      }
      const message = clean(body.message, 1000);
      if (!message) return json({ error: "Message is required." }, 400);
      const push = await deliverPush(env, message);
      if (!push.ok) return json({ error: push.reason }, 502);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  },

  // -------------------------------------------------------------------------
  // Reminder scheduler. Runs every minute.
  // -------------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    const now = Math.floor(Date.now() / 1000);
    const tz = env.TZ_NAME || "Europe/Stockholm";

    // `<= now` rather than `== this minute`, so a skipped cron run catches up
    // instead of dropping a reminder silently. The lower bound stops a
    // backlog from detonating all at once after an outage.
    // Every event's configured reminder times, tracked in
    // their own table — see dailyReminderInserts().
    const { results: dueReminders } = await env.DB.prepare(
      `SELECT r.id AS rid, e.title, e.start_time, e.all_day
       FROM reminders r JOIN events e ON e.id = r.event_id
       WHERE r.notify_at <= ?1 AND r.notify_at > ?2 AND r.notified_at IS NULL AND r.attempts < 5
       LIMIT 50`,
    )
      .bind(now, now - 3600)
      .all();

    // One settings read for the whole batch, not one per reminder.
    const settings = dueReminders.length ? await getSettings(env) : null;

    for (const rem of dueReminders) {
      const push = await deliverPush(env, rem.all_day ? rem.title : `${rem.start_time} — ${rem.title}`, settings);
      await env.DB.prepare(
        push.ok
          ? `UPDATE reminders SET notified_at = ?1, last_error = NULL WHERE id = ?2`
          : `UPDATE reminders SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2`,
      )
        .bind(push.ok ? now : push.reason, rem.rid)
        .run();
    }

    // Re-arm every yearly-recurring event's reminders once the prior
    // occurrence has passed and its rows have been cleaned up below — this
    // is what makes "repeats every year" actually keep recurring, rather
    // than firing once and going silent forever after.
    // Once an hour, not once a minute. Re-arming next year's birthday reminder
    // has no deadline, and sweeping every yearly event every 60 seconds was by
    // far the largest source of database reads in the whole app.
    // REARM_EVERY_TICK lets the tests exercise the sweep without waiting for
    // the top of the hour. Production sets it nowhere and gets hourly.
    const sweepDue = env.REARM_EVERY_TICK === "1" || new Date().getUTCMinutes() === 0;
    const yearlyEvents = sweepDue
      ? (await env.DB.prepare(
          `SELECT id, start_date, reminder_times FROM events WHERE repeat_yearly = 1 AND reminder_times != '[]'`,
        ).all()).results
      : [];
    for (const ev of yearlyEvents) {
      const times = JSON.parse(ev.reminder_times);
      const occurrence = nextYearlyOccurrence(ev.start_date, tz);
      // All of an occurrence's reminders are always inserted together, so
      // checking for the first one is a reliable stand-in for "already armed".
      const target = localToEpoch(occurrence, times[0], tz);
      const exists = await env.DB.prepare(`SELECT 1 FROM reminders WHERE event_id = ?1 AND notify_at = ?2`)
        .bind(ev.id, target)
        .first();
      if (!exists) {
        const inserts = dailyReminderInserts(env, ev.id, occurrence, times, tz);
        if (inserts.length) await env.DB.batch(inserts);
      }
    }

    // Housekeeping: expired lockout rows, and reminders too old to still be
    // due (their 1-hour delivery window above has long since passed).
    await env.DB.prepare(`DELETE FROM auth_attempts WHERE locked_until IS NOT NULL AND locked_until < ?`)
      .bind(now)
      .run();
    await env.DB.prepare(`DELETE FROM reminders WHERE notified_at IS NULL AND notify_at < ?`)
      .bind(now - 86400)
      .run();
    // Fired reminders (yearly ones especially) would otherwise accumulate
    // forever — a month's grace is plenty since nothing reads them after.
    await env.DB.prepare(`DELETE FROM reminders WHERE notified_at IS NOT NULL AND notified_at < ?`)
      .bind(now - 30 * 86400)
      .run();
  },
};
