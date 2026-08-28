-- bmmusic Build 2 — schema migration 2.
--
-- Additive only. Nothing here drops or rewrites anything: migration 0001 has
-- already run against minster-data, and the catalogue in it is the product of
-- somebody's afternoons in a cold song school.
--
-- Three groups of change:
--
--   1. Columns the v2 draft index brought with it (composer_full, surname,
--      season) plus the physical-location fields the volunteer sheets will
--      collect (door, shelf, spine state).
--   2. The service feed and its learning matcher — `service`, `service_music`,
--      `match_alias` — fed read-only from bmserviceapp. bmserviceapp's cron is
--      the estate's ONLY parser of the Minster's music list; this app consumes
--      its output and never parses that document itself.
--   3. Everything the admin refit needs to be accountable and self-service:
--      settings, an audit log, people and attendance, feedback, crowd scans,
--      label prints and booklets.
--
-- Data protection: `person` and `attendance` hold choristers' names and whether
-- they turned up. That is personal data about identifiable people, several of
-- them children. It lives in D1 and nowhere else — never in a log line, never
-- in analytics — and nothing on the choir side reads either table.

-- ---------------------------------------------------------------------------
-- piece — new columns
-- ---------------------------------------------------------------------------
--
-- `season` already exists from 0001. What is new is that it now carries a
-- controlled vocabulary rather than free text: semicolon-joined tags from the
-- list in src/church.config.ts (advent, christmas, epiphany, candlemas, lent,
-- passiontide, holyweek, easter, ascension, pentecost, trinity, harvest,
-- remembrance, allsaints, marian, saints, wedding, funeral, general).
--
-- It is deliberately NOT a CHECK constraint. The column holds a joined list,
-- so a CHECK could only match the whole string, and 0001's rows already hold
-- free text that a constraint would reject. The vocabulary is enforced where
-- it can produce a useful message instead — the importer flags an unknown tag
-- for review rather than the database refusing the write.

-- The composer as they would be written out in full ("Gregorio Allegri"). The
-- existing `composer` column keeps what is printed on the box, which is
-- usually a surname in capitals, and is what a volunteer matches against.
ALTER TABLE piece ADD COLUMN composer_full TEXT;

-- Surname alone, for filing order and for the label. Displaying it in capitals
-- is a THEME decision (src/theme.ts); the data stays in proper case.
ALTER TABLE piece ADD COLUMN surname TEXT;

-- Where the box physically is. Door A–H, then the shelf within that door.
-- Deliberately two columns rather than one string: "is anything on door C?" is
-- a question the volunteer-sheet run needs to answer by sorting, and the free
-- text `location` column from 0001 cannot be sorted usefully.
ALTER TABLE piece ADD COLUMN location_door TEXT;
ALTER TABLE piece ADD COLUMN location_shelf INTEGER;

-- 'ok'       — the box has a usable spine label.
-- 'none'     — no usable spine; auto-nominates for the repair queue (13A).
-- 'combined' — this box shares a combined label with its boxmates.
ALTER TABLE piece ADD COLUMN spine_state TEXT
  CHECK (spine_state IN ('ok','none','combined')) DEFAULT 'ok';

CREATE INDEX IF NOT EXISTS piece_surname_idx  ON piece (surname, title);
CREATE INDEX IF NOT EXISTS piece_location_idx ON piece (location_door, location_shelf);
CREATE INDEX IF NOT EXISTS piece_spine_idx    ON piece (spine_state);

-- ---------------------------------------------------------------------------
-- app_setting — small knobs, and the choir password.
--
-- The password is stored as a salted PBKDF2 hash, never in the clear. The
-- `password_generation` counter beside it is what makes rotation bite: it is
-- mixed into the session cookie's key derivation, so bumping it invalidates
-- every cookie already issued without touching SESSION_SECRET.
--
-- Falls back to the CHOIR_PASSWORD secret when there is no row here at all,
-- which is what makes first run work before James has been to the screen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_setting (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_by TEXT
);

-- ---------------------------------------------------------------------------
-- audit_log — every admin mutation, and who did it.
--
-- `user_email` comes from the Cf-Access-Authenticated-User-Email header that
-- Cloudflare Access stamps on every authenticated admin request. That header is
-- trusted ONLY on /admin/* routes, where Access has already run at the edge;
-- anywhere else it is an attacker-supplied string and is ignored.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  user_email TEXT,
  -- Verb: 'piece.update', 'accession.assign', 'password.change', 'bulk.edit'.
  action     TEXT NOT NULL,
  -- Table the action touched, where there is one.
  entity     TEXT,
  entity_id  INTEGER,
  -- One human-readable line. Never a password, never a chorister's attendance.
  detail     TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx     ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id);

-- ---------------------------------------------------------------------------
-- service — services, from the bmserviceapp feed.
--
-- Read-only consumption of the estate's single ingestion path. `feed_ref` is
-- the feed's own identifier for the service and is unique, so a re-fetch
-- upserts rather than duplicating.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- "YYYY-MM-DD".
  service_date TEXT NOT NULL,
  -- "HH:MM", local to Europe/London (src/church.config.ts).
  service_time TEXT,
  title        TEXT NOT NULL,
  -- Choir designation as published: "Boys and SATB", "Consort", "Girls".
  -- Joins to choir_profile.designation for the copies RAG.
  designation  TEXT,
  -- 'feed' (bmserviceapp) or 'manual' (added by an admin).
  source       TEXT NOT NULL DEFAULT 'feed',
  feed_ref     TEXT UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS service_date_idx ON service (service_date, service_time);

-- ---------------------------------------------------------------------------
-- service_music — one line of a service's music list, and what it matched.
--
-- The learning matcher. A normalised-token match against composer, surname,
-- titles and aliases proposes a piece as 'auto'; an admin confirms or fixes it
-- in one tap, which promotes it to 'confirmed' AND writes the pair into
-- `match_alias`. From then on the same raw text matches that piece outright.
--
-- `raw_text` is kept verbatim whatever happens. It is what the music list
-- actually said, and the chorister reading the home screen wants to see it
-- however well or badly it matched.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_music (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id  INTEGER NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  -- 'responses', 'psalm', 'canticles', 'anthem', 'setting', 'hymn', 'other'.
  slot        TEXT NOT NULL,
  raw_text    TEXT NOT NULL,
  piece_id    INTEGER REFERENCES piece(id) ON DELETE SET NULL,
  match_state TEXT NOT NULL DEFAULT 'unmatched'
              CHECK (match_state IN ('auto','confirmed','unmatched')),
  -- Order within the service, as the feed listed it.
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (service_id, slot, position)
);

CREATE INDEX IF NOT EXISTS service_music_service_idx ON service_music (service_id, position);
CREATE INDEX IF NOT EXISTS service_music_piece_idx   ON service_music (piece_id);
CREATE INDEX IF NOT EXISTS service_music_state_idx   ON service_music (match_state);

-- ---------------------------------------------------------------------------
-- match_alias — what the matcher has been taught.
--
-- One row per confirmed (raw music-list text → piece) pair, keyed on the
-- normalised form. This is the memory that stops James confirming
-- "Stanford in B flat" every single week for the rest of his life.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_alias (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Normalised raw text (see src/matcher.ts). Unique: one piece per phrasing.
  raw_norm   TEXT NOT NULL UNIQUE,
  piece_id   INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS match_alias_piece_idx ON match_alias (piece_id);

-- ---------------------------------------------------------------------------
-- person — the choir, for the register.
--
-- PERSONAL DATA. Names only: no email, no telephone, no address, no date of
-- birth. Several of these people are children, and the app has no business
-- holding anything about them beyond what marking a register needs.
-- Admin-managed; nothing choir-side reads this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  choir        TEXT NOT NULL CHECK (choir IN ('boys','girls','consort','satb')),
  -- 'soprano','alto','tenor1','tenor2','bass1','bass2'. NULL until known —
  -- section-level attendance RAG waits on this being filled in.
  voice_part   TEXT,
  -- Left the choir? Kept rather than deleted, so past registers still read.
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS person_choir_idx ON person (choir, active, display_name);

-- ---------------------------------------------------------------------------
-- attendance — who was at which service.
--
-- PERSONAL DATA, as above. One row per person per service; the UNIQUE lets the
-- register upsert as somebody taps their way down the list at the door.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('present','absent','excused')),
  marked_by  TEXT,
  marked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (service_id, person_id)
);

CREATE INDEX IF NOT EXISTS attendance_service_idx ON attendance (service_id);
CREATE INDEX IF NOT EXISTS attendance_person_idx  ON attendance (person_id);

-- ---------------------------------------------------------------------------
-- feedback — the widget's store.
--
-- No name and no email field, on purpose: the widget is on every page of a
-- choir-side app used by children, and asking for either would collect personal
-- data to no end. `ua` is the user-agent, which helps when somebody reports a
-- page looking wrong on a particular phone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- The path the widget was opened on, carried in a hidden field.
  page        TEXT,
  category    TEXT,
  message     TEXT NOT NULL,
  ua          TEXT,
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS feedback_at_idx ON feedback (resolved_at, at DESC);

-- ---------------------------------------------------------------------------
-- scan_submission — the crowd-scan approval queue.
--
-- A chorister photographing a copy on their phone produces a PENDING row and an
-- R2 object. Nothing is visible to anybody else until an admin approves it, at
-- which point a `file` row is written. That gate is the whole point: the choir
-- side must never surface an unreviewed photograph of somebody's marked-up copy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scan_submission (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  piece_id         INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  r2_key           TEXT NOT NULL UNIQUE,
  source           TEXT NOT NULL CHECK (source IN ('crowd','admin','campaign')),
  -- What the submitter said it was, in their words.
  submitted_label  TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  bytes            INTEGER,
  content_type     TEXT
);

CREATE INDEX IF NOT EXISTS scan_submission_status_idx ON scan_submission (status, at DESC);
CREATE INDEX IF NOT EXISTS scan_submission_piece_idx  ON scan_submission (piece_id);

-- ---------------------------------------------------------------------------
-- label_print — what has been printed, so a reprint is traceable.
--
-- Matters for the combined-label runs especially: when several boxes share
-- one label, knowing which run produced it is the only way to work out what to
-- reprint when one of them moves.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS label_print (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('spine','face','combined')),
  by_email TEXT
);

CREATE INDEX IF NOT EXISTS label_print_piece_idx ON label_print (piece_id, at DESC);

-- ---------------------------------------------------------------------------
-- booklet — produced PDFs, working copies included.
--
-- A working copy (a service's approved reference scans concatenated) is cached
-- here keyed on the service and a content hash, so tapping the button twice
-- costs one PDF rather than two. The proper booklet builder with the Minster
-- cover template is Phase 3; this table is the groundwork it will use.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booklet (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- "B-2026-001", or "W-<service>-<hash>" for a cached working copy.
  ref          TEXT NOT NULL UNIQUE,
  service_id   INTEGER REFERENCES service(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('working','proper')),
  -- Hash of the inputs the PDF was built from. A changed set of scans changes
  -- the hash, which is what makes the cache correct rather than merely fast.
  content_hash TEXT,
  pages        INTEGER,
  bytes        INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by   TEXT
);

CREATE INDEX IF NOT EXISTS booklet_service_idx ON booklet (service_id, kind);

-- ---------------------------------------------------------------------------
-- holding — the loan register (H5) and the stocktake clock (H6).
--
-- Loans hang off the holding rather than the piece because it is copies that
-- go out, not catalogue entries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id   INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  copies     INTEGER NOT NULL CHECK (copies > 0),
  -- Who has them. A name, nothing more.
  borrower   TEXT NOT NULL,
  reason     TEXT,
  out_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  due_back   TEXT,
  back_at    TEXT,
  logged_by  TEXT
);

CREATE INDEX IF NOT EXISTS loan_open_idx  ON loan (back_at, out_at DESC);
CREATE INDEX IF NOT EXISTS loan_piece_idx ON loan (piece_id, out_at DESC);
