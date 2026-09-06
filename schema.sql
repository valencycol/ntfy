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
-- Currently: `notify_channel` ('ntfy' | 'telegram' | 'both') and
-- `telegram_chat_id`. The bot token stays a Cloudflare secret.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
