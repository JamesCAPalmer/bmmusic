-- bmmusic Addendum A — modules, roles, the register, safeguarding.
--
-- The music department's real register has arrived: per-group attendance
-- driving quarterly chorister pay, per-service safeguarding duties, wedding
-- lists at a separate rate, school years, award dates and parent telephone
-- numbers. This migration is the architecture that absorbs it.
--
-- **Children's data is treated as a class apart throughout.** The rules, so
-- that nobody has to infer them from the schema:
--
--   * `parent_contact` is the hard-gated table. It is never rendered in a list,
--     never in an export other than the one explicit contacts export, and never
--     in a log, a feedback row, an error message or a URL. Reading one row is a
--     deliberate act that writes an audit line naming the viewer, the child and
--     the time.
--   * We hold a school year, never an age and never a date of birth. The app
--     cannot compute an age because it is not given the means.
--   * Everything about a person lives under `/admin/people*` or
--     `/admin/safeguarding*`, so a second and tighter Cloudflare Access
--     application can be scoped to those path prefixes later without a
--     refactor.
--
-- Additive, with one deliberate exception documented at the rebuild below.

-- ---------------------------------------------------------------------------
-- admin_role — in-app roles on top of Cloudflare Access
--
-- Access says *whether* somebody may reach /admin at all. This says what they
-- may do once there, which is a different question: the six people with a
-- Librarian policy are not all people who should see a child's telephone
-- number.
--
-- Identity is still the Cf-Access-Authenticated-User-Email header, trusted only
-- on /admin/* where Access has demonstrably run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_role (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  -- 'librarian'    — the music library: catalogue, labels, scans, services.
  -- 'music_staff'  — people, attendance, pay, awards, wardrobe, modules, roles.
  -- 'safeguarding' — the duty rota and the on-the-day duty view.
  role       TEXT NOT NULL CHECK (role IN ('librarian','music_staff','safeguarding')),
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (email, role)
);

CREATE INDEX IF NOT EXISTS admin_role_email_idx ON admin_role (email);

-- Bootstrap. Without a first music_staff nobody can grant anybody anything,
-- and the Roles screen is unreachable for ever.
INSERT OR IGNORE INTO admin_role (email, role, granted_by)
VALUES
  ('james@everinghampark.co.uk', 'librarian',    'migration 0003'),
  ('james@everinghampark.co.uk', 'music_staff',  'migration 0003'),
  ('james@everinghampark.co.uk', 'safeguarding', 'migration 0003');

-- ---------------------------------------------------------------------------
-- person — rebuilt.
--
-- **This is the one non-additive step in the file, and it is deliberate.**
-- `person.choir` carries a CHECK constraint, and the junior choir needs a
-- fifth value. SQLite cannot alter a CHECK in place; the documented procedure
-- is to build the new table, copy every row across, drop the old one and
-- rename.
--
-- **The register has to be carried across by hand, and that is the whole
-- reason the block below looks the way it does.** `DROP TABLE person` performs
-- an implicit `DELETE FROM person`; `attendance.person_id` is `ON DELETE
-- CASCADE`; so a schema change silently empties the register. The usual guard
-- — `PRAGMA foreign_keys=OFF` around the rebuild — does not work here, because
-- wrangler applies a migration inside a transaction and that pragma is a
-- documented no-op inside one. `PRAGMA legacy_alter_table=ON` is worse: it is
-- ignored just the same, and on the way past it rewrites `attendance`'s
-- foreign key to point at the renamed-away table.
--
-- Both were measured against a local D1 seeded with people and attendance
-- before this was written, and both lost every attendance row. So the register
-- is copied out, the cascade is allowed to happen, and it is put back.
--
-- The new columns are the register's: a school year (never an age, never a
-- date of birth — we are not given them and cannot derive them), the dates the
-- workbook tracks, a DBS expiry for adults who take duties, and a leaving date.
-- ---------------------------------------------------------------------------

-- Scratch, created and dropped inside this migration. `attendance` itself is
-- never dropped — only its rows are cascaded away, and they come back below.
CREATE TABLE IF NOT EXISTS attendance_carry AS SELECT * FROM attendance;

CREATE TABLE IF NOT EXISTS person_rebuilt (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,

  -- 'jc' is the junior choir (ages 5–8). Admin-only, never choir-side, and
  -- never counted for copies: they do not sing from music.
  choir        TEXT NOT NULL CHECK (choir IN ('boys','girls','consort','satb','jc')),

  voice_part   TEXT,
  active       INTEGER NOT NULL DEFAULT 1,

  -- NULL means an adult. A school year is the least we can hold and still run
  -- a register sensibly; an age or a date of birth would be more than we need.
  school_year  INTEGER,

  -- The workbook's dates. "YYYY-MM-DD", or NULL for "has not happened".
  joined_on              TEXT,
  surplice_awarded_on    TEXT,
  deans_award_on         TEXT,
  archbishops_award_on   TEXT,
  gold_award_on          TEXT,

  -- Adults who take safeguarding duties. NULL for everybody else, and the
  -- coverage check degrades gracefully rather than treating NULL as expired.
  dbs_valid_until TEXT,

  -- Recorded for duty adults only, so the rota can check that cover includes
  -- both genders when both the boys and the girls are due. Left NULL for
  -- children, and every check that uses it must work when it is unknown.
  gender       TEXT CHECK (gender IN ('m','f')),

  -- Set when somebody leaves. They drop out of registers and pickers, and
  -- their attendance still counts towards the aggregates already recorded.
  left_on      TEXT,

  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO person_rebuilt (id, display_name, choir, voice_part, active, created_at, updated_at)
  SELECT id, display_name, choir, voice_part, active, created_at, updated_at FROM person;

-- This is the statement that empties `attendance`. The rename immediately
-- after puts `attendance.person_id`'s foreign key back on a table that exists.
DROP TABLE person;
ALTER TABLE person_rebuilt RENAME TO person;

CREATE INDEX IF NOT EXISTS person_choir_idx  ON person (choir, active, display_name);
CREATE INDEX IF NOT EXISTS person_active_idx ON person (active, left_on);

-- The register, restored. Ids are preserved on both sides, so every row lands
-- against the same person it was recorded against. `OR IGNORE` because a
-- re-application must not double the register up against its UNIQUE.
INSERT OR IGNORE INTO attendance (id, service_id, person_id, status, marked_by, marked_at)
  SELECT id, service_id, person_id, status, marked_by, marked_at FROM attendance_carry;

DROP TABLE attendance_carry;

-- ---------------------------------------------------------------------------
-- parent_contact — the hard-gated table.
--
-- A telephone number for a child's parent. This is the most sensitive thing
-- the app holds, and the rules around it are not conventions but requirements:
--
--   * never rendered in any list, table or export except the one explicit
--     contacts export, which is music_staff only and separately audited;
--   * revealed one person at a time, by a deliberate action, which writes an
--     audit row naming the viewer, the child and the time;
--   * never in a log line, a feedback row, an error message or a URL.
--
-- Kept in its own table rather than as columns on `person` precisely so that
-- every ordinary `SELECT * FROM person` is safe by construction.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parent_contact (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  -- "parent 1", "parent 2", "grandmother" — whatever the workbook says.
  label      TEXT,
  name       TEXT,
  phone      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS parent_contact_person_idx ON parent_contact (person_id);

-- ---------------------------------------------------------------------------
-- rate — what a chorister is paid, per role, from a date.
--
-- Rows rather than a single figure because a rate changes and last quarter's
-- pay must still compute at last quarter's rate. `effective_from` is the whole
-- point: the pay export picks the rate in force on each service's date.
--
-- Nothing is seeded. The real figures are the music department's to set, and
-- inventing one would produce a plausible-looking pay run that is wrong.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'chorister_service', 'chorister_wedding'.
  role           TEXT NOT NULL,
  -- Pence, so no floating point ever touches money.
  amount_pence   INTEGER NOT NULL CHECK (amount_pence >= 0),
  effective_from TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by     TEXT,
  UNIQUE (role, effective_from)
);

CREATE INDEX IF NOT EXISTS rate_role_idx ON rate (role, effective_from DESC);

-- ---------------------------------------------------------------------------
-- service — what kind of event it is.
--
-- Weddings pay at a different rate, and practices are events a register and a
-- duty rota attach to but which are not services. Neither is on the
-- bmserviceapp feed, so both are created by hand — which is why the feed's
-- upsert must never overwrite this column with a default.
-- ---------------------------------------------------------------------------
ALTER TABLE service ADD COLUMN event_type TEXT
  CHECK (event_type IN ('regular','wedding','concert','tour','other')) DEFAULT 'regular';

CREATE INDEX IF NOT EXISTS service_event_type_idx ON service (event_type, service_date);

-- ---------------------------------------------------------------------------
-- duty — the safeguarding rota.
--
-- Three roles per event, each with a backup. Practices carry duties too, which
-- is why a manually created service with event_type 'other' is a first-class
-- thing rather than a workaround.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS duty (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('robing','general','dismissal')),
  is_backup  INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  -- Dismissal duty carries the Thursday rule: everybody under 18 collected.
  -- NULL until the person on duty ticks it.
  all_collected_at TEXT,
  all_collected_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (service_id, person_id, role, is_backup)
);

CREATE INDEX IF NOT EXISTS duty_service_idx ON duty (service_id, role, is_backup);
CREATE INDEX IF NOT EXISTS duty_person_idx  ON duty (person_id);

-- ---------------------------------------------------------------------------
-- Modules, dark by default.
--
-- The library and the services are what this app already is, so they are on.
-- Everything touching people is off until somebody deliberately turns it on —
-- and a disabled module's routes answer 404 rather than 403, because a 403
-- tells a reader that something is there.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO app_setting (key, value, updated_by) VALUES
  ('module.library',      'on',  'migration 0003'),
  ('module.services',     'on',  'migration 0003'),
  ('module.attendance',   'off', 'migration 0003'),
  ('module.safeguarding', 'off', 'migration 0003'),
  ('module.people',       'off', 'migration 0003'),
  ('module.wardrobe',     'off', 'migration 0003'),
  ('module.awards',       'off', 'migration 0003'),
  ('module.jc',           'off', 'migration 0003');
