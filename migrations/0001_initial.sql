-- bmmusic Phase 0 — initial schema.
--
-- Database: minster-data (D1). This app owns the tables below; the binding is
-- configured in the Cloudflare dashboard (see wrangler.toml). Applied with
-- `npm run migrate:local` / `npm run migrate:remote`.
--
-- Estate data boundary: this is a Minster database. Nothing belonging to
-- fobm-vestry / the Friends of Beverley Minster is stored here, ever.
--
-- Conventions:
--   * Text timestamps in ISO-8601 UTC, so they sort lexically.
--   * Dates that come off a physical label or a volunteer's phone are
--     "YYYY-MM-DD" — no time, because none was observed.
--   * Every table that the choir reads has ON DELETE CASCADE from piece:
--     deleting a piece should not leave orphaned holdings or scans behind.

-- ---------------------------------------------------------------------------
-- piece — the spine of the catalogue. One row per physical box.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS piece (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,

  -- "BM-0001" style, assigned in catalogue order by an admin in one click.
  -- NULL until assigned: the library has never had accession numbers, and
  -- inventing one is a human decision, not the importer's.
  accession          TEXT UNIQUE,

  -- Composer as printed on the label ("ANON (16th c.)", "MAWBY?").
  composer           TEXT NOT NULL,
  -- Folded form for sorting and matching (see src/normalise.ts).
  composer_canonical TEXT NOT NULL,

  -- Title as printed. Multi-title boxes keep the joined title verbatim
  -- ("O sing joyfully; Deliver us O Lord") and gain one alias per title.
  title              TEXT NOT NULL,

  -- A anthem / E evening canticles / M morning canticles / C communion setting
  -- / R responses / P psalm chant / X carol / S solo-other.
  category           TEXT NOT NULL CHECK (category IN ('A','E','M','C','R','P','X','S')),

  voicing            TEXT,
  season             TEXT,
  location           TEXT,

  -- The draft index's reference ("D-001"). Unique, and the key the seed
  -- importer matches on, which is what makes re-running it safe.
  legacy_ref         TEXT UNIQUE,

  notes              TEXT,

  -- Semicolon-joined reasons this row wants a human eye ("low confidence 0.55";
  -- "flag: damaged"; "category inferred from 'setting'"). NULL means settled.
  review_flag        TEXT,

  -- Set when a human confirms the row in the admin review queue. The seed
  -- importer refreshes rows where this is NULL and never touches rows where
  -- it is set, so a better CSV cut cannot undo somebody's afternoon.
  reviewed_at        TEXT,
  reviewed_by        TEXT,

  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS piece_composer_idx  ON piece (composer_canonical, title);
CREATE INDEX IF NOT EXISTS piece_category_idx  ON piece (category);
CREATE INDEX IF NOT EXISTS piece_review_idx    ON piece (reviewed_at, review_flag);

-- ---------------------------------------------------------------------------
-- alias — alternative names for a piece.
--
-- Two jobs: the individual titles of a multi-title box, and the variant
-- spellings a music list or a YouTube description might use. Matching an
-- upcoming music list to a box (Phase 2's pinch-point warnings) runs
-- through here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alias (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id   INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  alt_name   TEXT NOT NULL,
  -- Folded form for matching.
  alt_canonical TEXT NOT NULL,
  -- 'seed-title' (split from a multi-title box), 'manual', 'music-list'.
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (piece_id, alt_canonical)
);

CREATE INDEX IF NOT EXISTS alias_canonical_idx ON alias (alt_canonical);

-- ---------------------------------------------------------------------------
-- holding — how many copies there are, and what state they are in.
--
-- One row per count, not one per piece: the history of counts is worth having,
-- and a volunteer's count should never silently overwrite the last one. The
-- current holding is the most recent row (see src/catalogue.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holding (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id      INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,

  copies_total  INTEGER NOT NULL CHECK (copies_total >= 0),
  -- Copies actually fit to hand out. Never more than the total.
  copies_usable INTEGER NOT NULL CHECK (copies_usable >= 0),

  condition     TEXT NOT NULL CHECK (condition IN ('fine','average','poor','urgent')),

  -- "YYYY-MM-DD". The day the box was opened and counted.
  last_counted  TEXT NOT NULL,
  counted_by    TEXT,

  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  CHECK (copies_usable <= copies_total)
);

CREATE INDEX IF NOT EXISTS holding_piece_idx ON holding (piece_id, last_counted DESC, id DESC);

-- ---------------------------------------------------------------------------
-- file — scans and photographs held in R2 (bucket bmmusic-scans).
--
-- r2_key is the only pointer. Objects are streamed to signed-in users through
-- /file/:id; the bucket has no public access and this app mints no public
-- object URLs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id   INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('reference_scan','cover','other')),
  pages      INTEGER,
  bytes      INTEGER,
  -- Original filename or the label photo's reference, for tracing back.
  source_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS file_piece_idx ON file (piece_id, kind);

-- ---------------------------------------------------------------------------
-- performance — where and when a piece has been sung.
--
-- Populated in Phase 2 from bmserviceapp's music-list API and from mining the
-- Minster's YouTube archive. Never by parsing the music-list document here:
-- the estate has exactly one parser of that, and it is not this app.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS performance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id    INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  -- "YYYY-MM-DD".
  date        TEXT NOT NULL,
  service     TEXT,
  source      TEXT NOT NULL CHECK (source IN ('music_list','youtube')),
  youtube_url TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (piece_id, date, service, source)
);

CREATE INDEX IF NOT EXISTS performance_piece_idx ON performance (piece_id, date DESC);
CREATE INDEX IF NOT EXISTS performance_date_idx  ON performance (date DESC);

-- ---------------------------------------------------------------------------
-- choir_profile — the estate's choir designations and their typical size.
--
-- Seeded from src/church.config.ts. Phase 2 divides an upcoming service's
-- choir size into the usable copy count to find the pinch points.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS choir_profile (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  designation     TEXT NOT NULL UNIQUE,
  -- NULL where the maintainer has not confirmed a number. Omit rather than guess.
  typical_singers INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------------
-- repair_job — the repair queue.
--
-- Raised by a volunteer recording 'poor' or 'urgent' during the count, or by
-- an admin. 'open' → 'in_progress' → 'done', or 'abandoned'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_job (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id           INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE,
  reported_condition TEXT NOT NULL CHECK (reported_condition IN ('fine','average','poor','urgent')),
  volunteer          TEXT,
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','done','abandoned')),
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS repair_job_status_idx ON repair_job (status, created_at);
CREATE INDEX IF NOT EXISTS repair_job_piece_idx  ON repair_job (piece_id);
