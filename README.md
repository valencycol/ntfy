# events.colaco.se

A private calendar on Cloudflare Workers + D1. Pattern lock, colour-coded single
and multi-day events, ICS import with a per-event checklist, ntfy push to
iPhone, and a read-only .ics feed you can subscribe to in iOS Calendar.

## Layout

- `src/index.js` — the Worker: `/api/*`, the `.ics` feed, and the cron that
  fires reminders. It no longer serves any HTML.
- `webapp/` — the frontend, a Next.js app built on
  [big-calendar](https://github.com/lramos33/big-calendar). `next build`
  static-exports it to `webapp/out`, which the Worker serves as static assets.
- `src/app.html` — the previous single-file UI. No longer wired up; kept only
  as a reference and safe to delete.

Day, week, month, year and agenda views, drag-and-drop, and the event dialogs
come from big-calendar. The pattern lock, all-day handling, yearly repeats,
reminder times, ICS import, search, and the notifications panel are additions
on top of it.

## 1. Create the database

```bash
npm install -D wrangler
npx wrangler d1 create events
```

Paste the printed `database_id` into `wrangler.toml`, then load the schema:

```bash
npx wrangler d1 execute events --remote --file=./schema.sql
```

## 2. Generate the secrets

```bash
# Keep this pepper. You need it again if you ever change the pattern.
PEPPER=$(openssl rand -hex 32)
echo "PEPPER=$PEPPER"

# 01258 = top row left to right, then down the right column.
printf '01258:%s' "$PEPPER" | sha256sum | cut -d' ' -f1

openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 16   # FEED_TOKEN
openssl rand -hex 16   # NTFY_TOPIC — must be unguessable, see below
```

Then set them:

```bash
npx wrangler secret put AUTH_PEPPER      # the pepper
npx wrangler secret put PATTERN_HASH     # the sha256 line
npx wrangler secret put SESSION_SECRET
npx wrangler secret put FEED_TOKEN
npx wrangler secret put NTFY_TOPIC
```

To change the pattern later, re-run the `printf | sha256sum` line with the new
digit sequence and the same pepper, then `wrangler secret put PATTERN_HASH`.

## 3. Deploy

The frontend has to be built before the Worker is published, because the
Worker serves `webapp/out` as its static assets. `npm run deploy` does both:

```bash
npm install              # Worker tooling
npm --prefix webapp install   # frontend dependencies (first time only)

npm run deploy           # next build && wrangler deploy
```

To run it locally, `npm run dev` builds the frontend and starts
`wrangler dev` on http://localhost:8787 with the local D1 and `.dev.vars`.
While iterating on the frontend alone, `npm --prefix webapp run build` and a
browser refresh is enough — `wrangler dev` picks the new assets straight up.

Add `events` as a Workers custom domain for `events.colaco.se` in the Cloudflare
dashboard if `wrangler` does not create the DNS record itself.

## 4. ntfy on the iPhone

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
(`openssl rand -hex 16`), `wrangler secret put NTFY_TOPIC`, and re-subscribe
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

**Point this app at it:** tell Claude (or run yourself) the Render URL —
it becomes `NTFY_SERVER` in `wrangler.toml`'s `[vars]`, same as any other
self-hosted URL (see above; it's not sensitive, no secret needed).

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

## 5. Subscribe in iOS Calendar (optional, for seeing the calendar)

In the app, tap **Subscribe on iPhone** and open the `webcal://` link it shows.
Then Settings → Apps → Calendar → Accounts → Subscribed Calendars → pick it →
turn **Remove Alerts** off.

This feed is read-only and refreshes on iOS's own slow schedule. ntfy is what
actually gets reminders to you on time; the subscription is for glancing at the
month.

## Known limits

- **Events load a year either side of the year on screen.** Paging between
  months never waits on the network, but search only covers that window.
- **Recurring events are not expanded** — there's no RRULE storage, so an
  import only ever lands one occurrence. A yearly rule (birthdays,
  anniversaries) is rolled forward to its next upcoming date instead of the
  literal, often long-past, DTSTART; anything else (weekly, monthly, ...)
  keeps its literal first occurrence. Both cases are labelled in the import
  checklist. Re-import annually to pick up each year's next occurrence.
- **Import assumes Stockholm time** for events written with a `TZID` other than
  `Europe/Stockholm`. Those are flagged in the checklist. UTC (`Z`) times convert
  correctly.
- **The pattern is low-entropy** — roughly 15,000 possible five-dot patterns.
  Login throttling (5 tries, then a 15 minute lockout per IP) is what makes it
  safe, not the pattern itself. Do not remove it.
- **The feed token is a bearer credential.** Anyone with the URL can read the
  calendar. Rotate `FEED_TOKEN` if it leaks.
