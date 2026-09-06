# events.colaco.se

A private calendar on Cloudflare Workers + D1. Pattern lock, colour-coded single
and multi-day events, ICS import with a per-event checklist, reminders pushed to
your phone over **ntfy**, **Telegram** or both, and a read-only .ics feed you can
subscribe to in iOS Calendar.

- **Stack** — Cloudflare Workers, D1 (SQLite), a Next.js static export served as
  Worker assets, Cron Triggers for reminders, ntfy and the Telegram Bot API.
- **Live at** `https://events.colaco.se`

---

# Deploying from scratch

Everything below assumes a Cloudflare account (the free plan is enough) and
Node 20 or newer. Steps 1-7 take a clean checkout to a working deployment.

## Requirements

```bash
node -v      # v20 or newer
npm -v
git --version
openssl version
```

`shasum` is used to hash the unlock pattern. It ships with macOS and with most
Linux distributions; on Linux you can use `sha256sum` instead wherever this
README says `shasum -a 256`.

## 1. Clone and install

```bash
git clone git@github.com:valencycol/ntfy.git events
cd events

npm install                   # Worker tooling: wrangler, Playwright
npm --prefix webapp install   # frontend dependencies
```

Two `package.json` files is deliberate: the Worker and the Next.js frontend have
separate dependency trees, and `npm install` at the root does **not** install the
frontend's. If you skip the second line the build fails at step 6, not here.

## 2. Log in to Cloudflare

```bash
npx wrangler login
```

This opens a browser and authorises `wrangler` against your account. Confirm it
picked the right one:

```bash
npx wrangler whoami
```

## 3. Create the database

```bash
npx wrangler d1 create events
```

It prints a `database_id`. Paste it into `wrangler.toml` under
`[[d1_databases]]`, replacing the one that is there:

```toml
[[d1_databases]]
binding = "DB"
database_name = "events"
database_id = "PASTE-YOURS-HERE"
```

Then create the tables:

```bash
npx wrangler d1 execute events --remote --file=./schema.sql
```

`--remote` is the important flag — without it you create the tables in the
*local* development database and the deployed Worker finds nothing. The file is
all `CREATE TABLE IF NOT EXISTS`, so re-running it later is safe and touches no
rows. You will run it again in step 5 of the Telegram section.

## 4. Make `wrangler.toml` yours

Three things in it are specific to this deployment and need changing:

| Field | Change it to |
| --- | --- |
| `name` | Your Worker's name — it becomes part of the `*.workers.dev` URL. |
| `routes` | Your own domain, or delete the block entirely (see below). |
| `database_id` | Done in step 3. |

**If you have a domain on Cloudflare**, point it at the Worker:

```toml
routes = [
  { pattern = "calendar.example.com", custom_domain = true }
]
```

Cloudflare issues the certificate automatically. If `wrangler` does not create
the DNS record itself, add the Worker as a custom domain in the dashboard
(Workers & Pages → your Worker → Settings → Domains & Routes).

**If you don't**, delete the whole `routes = [...]` block and the Worker is
served at `https://<name>.<your-subdomain>.workers.dev`. Everything works there;
only the URL differs.

While you are in the file, check `TZ_NAME` under `[vars]`. Every reminder time
is a wall-clock time in that zone, so getting it wrong shifts every reminder by
the offset:

```toml
[vars]
TZ_NAME = "Europe/Stockholm"
```

## 5. Generate and set the secrets

Nothing sensitive lives in `wrangler.toml`. Generate the values first:

```bash
# Keep this pepper somewhere safe. You need it again to change the pattern
# or the superuser phrase — losing it means regenerating both.
PEPPER=$(openssl rand -hex 32)
echo "PEPPER=$PEPPER"

# Your unlock pattern, as dot indices on a 3×3 grid numbered 0-8 left to
# right, top to bottom. 01258 = the top row, then down the right column.
printf '01258:%s' "$PEPPER" | shasum -a 256 | cut -d' ' -f1

# The superuser passphrase, hashed with the same pepper. This is what
# unlocks deleting events; pick a phrase and substitute it here.
printf 'your-superuser-phrase:%s' "$PEPPER" | shasum -a 256 | cut -d' ' -f1

openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 16   # FEED_TOKEN
openssl rand -hex 16   # NTFY_TOPIC — must be unguessable, see below
```

Then set each one. `wrangler` prompts for the value and never echoes it:

```bash
npx wrangler secret put AUTH_PEPPER      # the pepper
npx wrangler secret put PATTERN_HASH     # the first sha256 line
npx wrangler secret put SUPERUSER_HASH   # the second sha256 line
npx wrangler secret put SESSION_SECRET
npx wrangler secret put FEED_TOKEN
npx wrangler secret put NTFY_TOPIC
```

Paste **only the hash**, with no trailing newline or spaces — a stray character
makes the pattern silently never match, and the error you get says nothing about
why. The iPhone setup dialog warns you if `NTFY_TOPIC` has whitespace around it
for the same reason.

`SUPERUSER_HASH` is optional. Without it the app works, but deleting events is
refused with "Superuser is not configured on this deployment."

`TELEGRAM_BOT_TOKEN` is the one other secret, and it is also optional — see
[Reminders via Telegram](#reminders-via-telegram).

To change the pattern later, re-run the `printf | shasum` line with the new digit
sequence and the **same** pepper, then `npx wrangler secret put PATTERN_HASH`.

## 6. Deploy

The frontend has to be built before the Worker is published, because the Worker
serves `webapp/out` as its static assets. `npm run deploy` does both, with the
test suite in between:

```bash
npx playwright install chromium   # once per machine, for the test gate
npm run deploy                    # build:web && test && wrangler deploy
```

That takes about ten minutes, nearly all of it the 300-odd Playwright tests.
Cloudflare's part is roughly 25 seconds. For a cosmetic change you are confident
about:

```bash
npm run deploy:skip-tests         # build:web && wrangler deploy
```

Never use bare `wrangler deploy`: it ships whatever is already in `webapp/out`,
which after a frontend edit is the *previous* build.

## 7. Verify

Open the URL, draw your pattern, and add an event. Then check the parts that
only work in production:

```bash
npx wrangler tail        # live logs; leave this running while you use the app
```

Give an event a reminder a couple of minutes out and watch for it. The cron runs
every minute, so you will not wait long, and `wrangler tail` shows each
`scheduled` invocation as it happens — which is the real proof the trigger is
registered. The dashboard lists it too, under Workers & Pages → your Worker →
Settings → Trigger Events.

Test the whole path rather than trusting the log: a reminder that the Worker
logged as sent has still only been *accepted* by ntfy or Telegram, and the iOS
quirks below are where they most often stop.

---

# Reminders

Reminders are fixed clock times on an event's day — up to five per event, set in
the event sheet. The Worker's cron checks every minute and pushes whatever is
due to your phone.

Where they go is a setting in the app, not in `wrangler.toml`: menu → **iPhone
setup** → *Send reminders to*.

| Setting | Behaviour |
| --- | --- |
| **ntfy only** | The default. |
| **Telegram only** | ntfy is not contacted at all. |
| **Both** | Sent to both; delivered as soon as **either** accepts it. |

"Both" deliberately succeeds on one arrival. A reminder that reached your phone
has done its job, and failing the whole delivery because the second channel was
down would only schedule a retry that re-sends on the channel that worked.

The choice lives in D1 so you can switch channels from the phone when one of
them is having a bad day — no deploy, no `wrangler` on hand.

If a channel starts failing, the reason it gave is kept per reminder in
`reminders.last_error` and surfaces in the notifications panel as a failed
attempt count.

## Reminders via ntfy

1. Install **ntfy** from the App Store.
2. Tap **+**. If you're using the public service leave the server as `ntfy.sh`;
   if you're self-hosting, enter your own server's URL instead (see below).
   Enter your `NTFY_TOPIC` value either way.
3. Test before trusting it:
   ```bash
   curl -H "Title: Coming up" -H "Priority: 4" -d "Test reminder" https://ntfy.sh/YOUR_TOPIC
   ```
4. Check it makes a **sound**, not just a banner. There is a known open bug where
   ntfy notifications arrive silently on recent iOS. If yours are silent, the
   Worker change to Pushover is the two lines in `scheduled()`.
5. iOS Settings → Notifications → ntfy → allow Sounds, and add it to any Focus
   mode you use, or reminders will be held back.

Self-hosting your own ntfy server instead of the public one? Set `NTFY_SERVER`
in `wrangler.toml` (`[vars]`, no trailing slash) to its URL — the Worker sends
pushes there instead. There's nothing sensitive in that URL, so it's a plain
var, not a secret. Leave it unset (or delete the line) to use `ntfy.sh`.

`NTFY_TOPIC`, on the other hand, **is** sensitive — anyone who has it can read
your reminders or send you fake ones. If it ever leaks (pasted somewhere,
committed by accident, ...), rotate it immediately: generate a new one
(`openssl rand -hex 16`), `npx wrangler secret put NTFY_TOPIC`, and re-subscribe
in the iOS app with the new value.

**Why this app self-hosts ntfy rather than using the public service.**
ntfy.sh's public tier rate-limits publishing per source IP — and Cloudflare
Workers share IP ranges with countless unrelated Workers, so that shared
quota can (and did) run out from traffic that has nothing to do with this
app (`429: daily message quota reached`). A free ntfy.sh account does not
get a meaningfully separate quota — only paid plans do (reserved topics +
higher limits). Self-hosting has no quota at all.

For iOS to receive *instant* background pushes from a self-hosted server,
its config needs:
```yaml
upstream-base-url: "https://ntfy.sh"
```
This does **not** re-expose you to the shared quota — it only relays a tiny
"go check your server" wake-up signal through ntfy.sh's Firebase/APNs
integration (which the official app is built against and can't be pointed
elsewhere); the actual message content is fetched from, and never leaves,
your own server. It's ntfy's documented, intended way to self-host for iOS,
not a workaround.

### Self-hosting ntfy on Render (free) + UptimeRobot

**Deploy ntfy:**

1. Sign up free at https://render.com.
2. Dashboard → **New** → **Web Service** → **Deploy an existing image from a
   registry**.
3. Image URL: `docker.io/binwiederhier/ntfy`.
4. Name it (e.g. `ntfy-personal`) — this fixes your URL as
   `https://ntfy-personal.onrender.com` (Render assigns it from the name
   immediately, before the first deploy even succeeds). Instance type:
   **Free**.
5. Set the **Docker Command** to `ntfy serve` (the full command, not just
   `serve`) — the image's `Dockerfile` only sets `ENTRYPOINT ["ntfy"]` with
   no default command, and Render's custom command *replaces* the
   entrypoint rather than appending to it, so the binary name has to be
   included explicitly or the container fails immediately with no ntfy
   output at all.
6. Under **Environment Variables**, add (using the URL from step 4):
   ```
   NTFY_LISTEN_HTTP=:10000
   NTFY_BASE_URL=https://ntfy-personal.onrender.com
   NTFY_UPSTREAM_BASE_URL=https://ntfy.sh
   NTFY_BEHIND_PROXY=true
   ```
   Render's web services default to expecting port `10000`, and while it
   says it can "usually" detect a different port automatically, ntfy's
   image defaults to `:80` — pinning `NTFY_LISTEN_HTTP` explicitly avoids
   relying on that detection at all. `NTFY_BASE_URL` is required whenever
   `NTFY_UPSTREAM_BASE_URL` is set — it's how ntfy tells your phone where
   to poll back for a message's actual content after the wake-up signal.
   `NTFY_BEHIND_PROXY` makes ntfy read the real client IP from Render's
   proxy headers instead of logging every request as coming from Render
   itself.
7. Create the service and wait for the deploy to finish.
8. Test it directly before trusting it:
   ```bash
   curl -d "Test message" https://ntfy-personal.onrender.com/YOUR_TOPIC
   ```

**Keep it from sleeping (UptimeRobot):**

Render's free tier spins a service down after ~15 minutes with no traffic,
then cold-starts (30-60s) on the next request. A periodic ping prevents
that idle-based sleep — it does **not** prevent Render's own occasional
maintenance restarts, which are rarer and outside your control either way.

1. Sign up free at https://uptimerobot.com.
2. **Add New Monitor** → Monitor Type: **HTTP(s)**.
3. URL: your Render URL from above.
4. Monitoring interval: **5 minutes** (the free plan's minimum, comfortably
   under Render's 15-minute idle window).
5. Save.

**Point this app at it:** set the Render URL as `NTFY_SERVER` in
`wrangler.toml`'s `[vars]`, same as any other self-hosted URL (see above; it's
not sensitive, no secret needed), then redeploy.

**Re-point the iOS app:**

1. Open ntfy → tap your existing subscription → remove it (or add the new
   one first and remove the old one once you've confirmed it works).
2. Tap **+** → enter your Render URL as the server instead of `ntfy.sh`.
3. Enter your `NTFY_TOPIC` value (the same one, or a fresh one — your call;
   a fresh one is a reasonable idea since this is a natural point to rotate).
4. Subscribe, then test with the `curl` command above and confirm the push
   arrives with a **sound**, not just a silent banner (see the iOS quirks
   above — Settings → Notifications → ntfy → Sounds, and any Focus mode
   exception).

## Reminders via Telegram

A second channel, alongside ntfy or instead of it. It needs no server of your
own and has no message quota, which makes it a good backup for the times a
free-tier ntfy instance is cold-starting or asleep.

This bot only ever **speaks** — nothing in the calendar is resolved from a
notification — so there is no webhook to register, no public callback URL, and
no webhook secret. One secret and you're done.

### 1. Create the bot

In Telegram, open **@BotFather** → `/newbot`. Give it a display name and a
username ending in `bot`. It replies with a token.

### 2. Set the token

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN   # from BotFather
```

### 3. Make sure the `settings` table exists

The channel choice is stored in D1, in a `settings` table that is newer than the
rest of the schema. Migrations do **not** run on deploy, so a database created
before this feature needs the schema re-run once:

```bash
npx wrangler d1 execute events --remote --file=./schema.sql
```

Safe on an existing database — it is all `CREATE TABLE IF NOT EXISTS` and
touches no rows. Skip it and the app silently stays on ntfy rather than failing.

### 4. Deploy

```bash
npm run deploy
```

### 5. Link your chat

A Telegram bot **cannot message you first**, so it has to hear from you once:

1. Open a chat with your new bot and tap **Start**.
2. In the calendar, open the menu → **iPhone setup** → *Reminders via Telegram*.
   The section names the bot the token belongs to, which is the quickest way to
   confirm the secret went in correctly.
3. Tap **Find my chat**. It asks the bot who has messaged it and fills in your
   chat ID.
4. Tap **Send test** and confirm the message arrives. This works regardless of
   which channel is currently selected — test Telegram *before* trusting it.
5. Set **Send reminders to** and press **Save**.

To reach a group instead, add the bot to the group, send a message there, and
**Find my chat** will offer it too. A channel works as `@channelname`, with the
bot added as an administrator. For a person it is always the **number** — the
Bot API cannot address someone by `@username`, which is the whole reason the
linking step exists.

**Give the calendar its own bot.** If you point `TELEGRAM_BOT_TOKEN` at a bot
another app already drives, **Find my chat** fails: Telegram lets a bot use a
webhook *or* `getUpdates`, never both, and the other app owns the webhook. The
dialog says so and names the bot the token really belongs to. Do **not** run
`deleteWebhook` to get past it — that breaks the other app. Either make a second
bot, or type the chat ID in by hand, which needs no `getUpdates` at all.

Not sure what your chat ID is? Message **@userinfobot**; it replies with your
user ID, which is your private chat ID for every bot. It is neither your
`@username` nor your phone number.

Only the bot token is a secret. The chat ID is not one — it identifies a chat but
does not grant access to it — so it is stored as an ordinary setting and stays
editable in the dialog.

---

# Subscribe in iOS Calendar (optional, for seeing the calendar)

In the app, tap **Subscribe on iPhone** and open the `webcal://` link it shows.
Then Settings → Apps → Calendar → Accounts → Subscribed Calendars → pick it →
turn **Remove Alerts** off.

This feed is read-only and refreshes on iOS's own slow schedule. The reminder
channels above are what actually get reminders to you on time.

The feed URL contains `FEED_TOKEN` and needs no login, because iOS Calendar
cannot send one. Anyone with the link can read your events, so treat it as a
secret; rotate it with `npx wrangler secret put FEED_TOKEN` and re-subscribe.

---

# Local development

```bash
npm run dev    # build:web && wrangler dev on http://localhost:8787
```

It uses a local D1 and reads secrets from `.dev.vars`, which is gitignored and
never deployed. Create your own:

```bash
# Throwaway values — this file never leaves your machine. Pattern: 01258.
PEPPER=dev-pepper
cat > .dev.vars <<EOF
AUTH_PEPPER=$PEPPER
PATTERN_HASH=$(printf '01258:%s' "$PEPPER" | shasum -a 256 | cut -d' ' -f1)
SUPERUSER_HASH=$(printf 'dev-phrase:%s' "$PEPPER" | shasum -a 256 | cut -d' ' -f1)
SESSION_SECRET=dev-session-secret
FEED_TOKEN=devfeedtoken
NTFY_TOPIC=devtopic
EOF

# The local database is separate from the remote one, and needs its own schema.
npx wrangler d1 execute events --local --file=./schema.sql
```

Note the unquoted `EOF` on the first line: that is what lets the `$(...)`
substitutions run. Quoting it, as the other heredocs in this README do, would
write the commands into the file literally.

Local dev talks to the real ntfy and Telegram services, so add
`TELEGRAM_BOT_TOKEN` to `.dev.vars` only if you want to exercise it for real.

While iterating on the frontend alone, `npm --prefix webapp run build` and a
browser refresh is enough — `wrangler dev` picks up the new assets directly.

## Tests

```bash
npm test              # everything, ~10 minutes
npm run test:api      # the Worker's API surface only, ~1 minute
npm run test:ui
npm run test:mobile
```

The suite runs against a real `wrangler dev` on its own port (8788) with its own
D1 directory and throwaway secrets from `tests/test.env`, so it never touches
your local data. Both ntfy and the Telegram Bot API are stubbed by small servers
in `tests/support/`, which means deliveries are **asserted**, not assumed.

Projects run in order — api → ui → mobile → throttle — with `ui` depending on
`api`, so a broken API fails fast and clearly instead of as a UI timeout.

---

# Configuration reference

## Vars (`wrangler.toml`, not sensitive)

| Var | Default | Meaning |
| --- | --- | --- |
| `TZ_NAME` | `Europe/Stockholm` | Timezone every stored wall-clock time is interpreted in. |
| `NTFY_SERVER` | `https://ntfy.sh` | Your ntfy server, no trailing slash. |

## Secrets (`npx wrangler secret put NAME`)

| Secret | Required | Meaning |
| --- | --- | --- |
| `AUTH_PEPPER` | yes | Long random string mixed into both hashes below. |
| `PATTERN_HASH` | yes | `sha256(pattern + ":" + AUTH_PEPPER)`. |
| `SESSION_SECRET` | yes | Signs the session cookie. |
| `FEED_TOKEN` | yes | The credential in the read-only `.ics` feed URL. |
| `NTFY_TOPIC` | for ntfy | Your unguessable ntfy topic. |
| `SUPERUSER_HASH` | no | `sha256(phrase + ":" + AUTH_PEPPER)`. Unlocks deleting events. |
| `TELEGRAM_BOT_TOKEN` | for Telegram | The token @BotFather gives you. |

## Stored settings (D1, edited in the app)

| Key | Meaning |
| --- | --- |
| `notify_channel` | `ntfy`, `telegram` or `both`. |
| `telegram_chat_id` | The chat reminders are sent to. |

---

# How it fits together

- `src/index.js` — the Worker: `/api/*`, the `.ics` feed, the ntfy and Telegram
  clients, and the cron that fires reminders. It serves no HTML.
- `webapp/` — the frontend, a Next.js app built on
  [big-calendar](https://github.com/lramos33/big-calendar). `next build`
  static-exports it to `webapp/out`, which the Worker serves as static assets.
- `schema.sql` — the whole database. Re-runnable; there is no migration runner.
- `tests/` — Playwright, with the ntfy and Telegram stubs under `tests/support/`.
- `src/app.html` — the previous single-file UI. No longer wired up; kept only as
  a reference and safe to delete.

Requests hit the static assets first; anything that isn't a file — `/api/*`, the
`.ics` feed — falls through to the Worker.

Day, week, month, year and agenda views, drag-and-drop, and the event dialogs
come from big-calendar. The pattern lock, all-day handling, yearly repeats,
reminder times, ICS import, search, and the notifications panel are additions on
top of it.
