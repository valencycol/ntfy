-- Events. Dates are local wall-clock strings in TZ_NAME; notify_at is a unix epoch.
CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  uid            TEXT UNIQUE,              -- iCalendar UID, used to dedupe imports
  title          TEXT NOT NULL,
  notes          TEXT,
  start_date     TEXT NOT NULL,            -- YYYY-MM-DD
  end_date       TEXT NOT NULL,            -- YYYY-MM-DD, inclusive
  start_time     TEXT,                     -- HH:MM, NULL when all_day
  end_time       TEXT,                     -- HH:MM, NULL when all_day
  all_day        INTEGER NOT NULL DEFAULT 1,
  color          TEXT NOT NULL,            -- #rrggbb
  remind_minutes INTEGER,                  -- minutes before start; NULL = no reminder
  notify_at      INTEGER,                  -- unix seconds, NULL = no reminder
  notified_at    INTEGER,                  -- set once ntfy accepts the push
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  repeat_yearly  INTEGER NOT NULL DEFAULT 0, -- birthdays/anniversaries: recurs on this month+day every year
  reminder_times TEXT NOT NULL DEFAULT '[]'  -- JSON array of "HH:MM" local clock times to ping on the event's day
);

CREATE INDEX IF NOT EXISTS idx_events_range  ON events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_notify ON events(notify_at) WHERE notified_at IS NULL;

-- Login throttling. The pattern space is small, so this table is doing real work.
CREATE TABLE IF NOT EXISTS auth_attempts (
  ip           TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);

-- One row per fixed-clock-time reminder an event has configured (see
-- events.reminder_times, 0-5 "HH:MM" entries, editable in the sheet — the
-- old single before-start reminder is retired in favor of this). Kept in
-- their own table, rather than more columns on `events`, so there can be
-- several per event. For a `repeat_yearly` event they target its next
-- occurrence, and the scheduler re-arms next year's set once these fire.
CREATE TABLE IF NOT EXISTS reminders (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  notify_at    INTEGER NOT NULL,
  notified_at  INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT                    -- why the most recent attempt failed, if it did
);

CREATE INDEX IF NOT EXISTS idx_reminders_notify ON reminders(notify_at) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reminders_event  ON reminders(event_id);

-- App settings that are a *choice* rather than a credential, so they belong in
-- the database and can be changed from the UI instead of needing a deploy.
-- Currently: `notify_channel` ('ntfy' | 'telegram' | 'both'), `telegram_offset`
-- (the getUpdates cursor, see below) and the legacy single `telegram_chat_id`,
-- which is migrated into telegram_recipients on first read. The bot token
-- stays a Cloudflare secret.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Everyone a reminder goes to on Telegram.
--
-- A bot cannot open a conversation, and the Bot API cannot address a person by
-- @username or phone number at all — only by numeric chat_id. So the handle you
-- type is stored as the *expected* identity and `chat_id` stays NULL until that
-- person actually starts the bot; only then can anything be sent. They are
-- matched on arrival by the one-time `link_code` carried in the invite deep
-- link, or failing that by username, or by the digits of a shared contact.
CREATE TABLE IF NOT EXISTS telegram_recipients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,          -- what you call them, for the UI
  handle        TEXT,                   -- as typed: '@alvita' or '+46701234567'
  handle_kind   TEXT,                   -- 'username' | 'phone' | NULL
  handle_digits TEXT,                   -- phone reduced to digits, to match a shared contact
  chat_id       TEXT,                   -- bound on /start; NULL = invited, not linked yet
  tg_username   TEXT,                   -- what Telegram actually reported at link time
  tg_name       TEXT,
  link_code     TEXT,                   -- one-time deep-link payload, cleared once used
  linked_at     INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_recipients_chat ON telegram_recipients(chat_id) WHERE chat_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_recipients_code ON telegram_recipients(link_code) WHERE link_code IS NOT NULL;

-- Chats that have messaged the bot but aren't a recipient yet, so "who has
-- started the bot?" survives the getUpdates cursor moving past them. Polling
-- consumes each update exactly once, so without this the answer would vanish.
CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id  TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  username TEXT,
  type     TEXT,
  seen_at  INTEGER NOT NULL
);
