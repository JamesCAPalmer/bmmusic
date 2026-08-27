-- bmmusic Addendum A — the workbook importer's pending state.
--
-- The music department's register is an Excel workbook. It arrives here by
-- being uploaded, read, and **shown to a person before anything is written to
-- `person`**. That review step is the whole point: the workbook is a working
-- document with blank cells, two spellings of the same child, and adults mixed
-- in with children, and the app must not decide what any of that means.
--
-- So an upload lands here — parsed, numbered by the row it came from, and
-- pending — and stays here until somebody says yes. Nothing in these two
-- tables is real until it has been applied.
--
-- Additive. Nothing above 0003 is touched.

-- ---------------------------------------------------------------------------
-- import_batch — one upload
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_batch (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- 'pending'   — read, shown, waiting on a human.
  -- 'applied'   — the rows somebody accepted have been written.
  -- 'discarded' — thrown away without writing anything.
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','applied','discarded')),
  decided_at  TEXT,
  decided_by  TEXT,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS import_batch_status_idx ON import_batch (status, uploaded_at DESC);

-- ---------------------------------------------------------------------------
-- import_row — one line of the workbook, as read
--
-- **This holds children's names**, and for a while it holds them twice: once
-- here and once in `person` after the batch is applied. That is the cost of
-- reviewing before writing, and it is why a batch is deleted outright when it
-- is discarded rather than kept as a record — an unapplied upload is a copy of
-- personal data with no purpose, and the audit line saying it was discarded is
-- the record that matters.
--
-- `payload` is the parsed fields as JSON rather than columns, because the
-- workbook's shape is not settled: the sheets and their headings will change
-- before the real import happens, and a schema that has to change with them
-- would mean a migration every time somebody adds a column in Excel.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_row (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id   INTEGER NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  sheet      TEXT,
  -- The row number in the spreadsheet, so a problem can be pointed at.
  row_number INTEGER,
  kind       TEXT NOT NULL CHECK (kind IN ('person','attendance')),
  payload    TEXT NOT NULL,
  -- What the reader could not settle: a name that already exists, a school
  -- year that did not parse, a date it could not read. Null when it is clean.
  issue      TEXT,
  -- Set when this row was actually written. A batch can be applied with some
  -- rows accepted and others left, and re-applying must not double anybody up.
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS import_row_batch_idx ON import_row (batch_id, sheet, row_number);
