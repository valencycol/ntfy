-- Deterministic fixture data. Dates are deliberately fixed rather than
-- relative to "now", except where a test needs something due soon, which the
-- helpers insert at runtime.
DELETE FROM reminders;
DELETE FROM events;
DELETE FROM auth_attempts;

INSERT INTO events (id, uid, title, notes, start_date, end_date, start_time, end_time,
                    all_day, color, created_at, repeat_yearly, reminder_times) VALUES
  -- A plain timed event.
  ('11111111-1111-4111-8111-111111111111', 'seed-standup', 'Standup', 'Daily sync',
   '2026-09-04', '2026-09-04', '09:15', '09:30', 0, '#2563eb', 1750000000, 0, '["09:00"]'),

  -- Timed, with several reminders including a 15-min-before entry.
  ('22222222-2222-4222-8222-222222222222', 'seed-dentist', 'Dentist', NULL,
   '2026-09-04', '2026-09-04', '14:00', '15:00', 0, '#dc2626', 1750000000, 0, '["00:00","09:00","13:45"]'),

  -- Yearly, anchored long in the past (a birthday's true origin date).
  ('33333333-3333-4333-8333-333333333333', 'seed-birthday', 'Mum birthday', NULL,
   '1968-09-07', '1968-09-07', NULL, NULL, 1, '#9333ea', 1750000000, 1, '["00:00","09:00"]'),

  -- Multi-day all-day span.
  ('44444444-4444-4444-8444-444444444444', 'seed-conference', 'Conference', 'Three days',
   '2026-09-09', '2026-09-11', NULL, NULL, 1, '#16a34a', 1750000000, 0, '["09:00"]'),

  -- Single-day all-day, which must never render as a 24-hour block.
  ('55555555-5555-4555-8555-555555555555', 'seed-holiday', 'Public holiday', NULL,
   '2026-09-21', '2026-09-21', NULL, NULL, 1, '#ca8a04', 1750000000, 0, '[]'),

  -- Second yearly event, in a different month.
  ('66666666-6666-4666-8666-666666666666', 'seed-anniversary', 'Anniversary', NULL,
   '2015-10-02', '2015-10-02', NULL, NULL, 1, '#ea580c', 1750000000, 1, '["00:00","09:00"]'),

  -- Late-evening event, to check the time grid extends past working hours.
  ('77777777-7777-4777-8777-777777777777', 'seed-late', 'Late meeting', NULL,
   '2026-09-04', '2026-09-04', '17:00', '19:00', 0, '#525252', 1750000000, 0, '["16:45"]'),

  -- Feb 29: a yearly event with no occurrence in non-leap years.
  ('88888888-8888-4888-8888-888888888888', 'seed-leapday', 'Leap day thing', NULL,
   '2000-02-29', '2000-02-29', NULL, NULL, 1, '#2563eb', 1750000000, 1, '["09:00"]'),

  -- A note past the 300-character preview cut-off.
  ('99999999-9999-4999-8999-999999999999', 'seed-longnote', 'Long note meeting',
   'Agenda: ' || replace(hex(zeroblob(200)), '00', 'long note text '), '2026-09-16', '2026-09-16',
   '11:00', '12:00', 0, '#9333ea', 1750000000, 0, '[]');
