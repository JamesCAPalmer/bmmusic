# Changelog

A reverse-chronological history of substantive changes to bmmusic,
grouped by working session, in the style of the estate's hub repo. Each
entry says what changed and why, so future-you can navigate back to the
diff.

---

## Session 2 — Build 2

### Milestone 1 — schema migration 2

`migrations/0002_build2.sql`, additive only. Nothing dropped, nothing
rewritten: 0001 has already run against `minster-data`, and what is in it
is the product of somebody's afternoons in a cold song school.

**New columns on `piece`.** `composer_full` and `surname` come from
index v2; `location_door` (A–H), `location_shelf` and `spine_state`
('ok' / 'none' / 'combined') are what the volunteer sheets will collect.
Door and shelf are two columns rather than one string because "what is
on door C?" is a question the sheet run answers by sorting, and the free
text `location` column from 0001 cannot be sorted usefully.

**Eleven new tables.** `service` and `service_music` take the
bmserviceapp feed; `match_alias` is the matcher's memory. `app_setting`
holds the hashed choir password and small knobs; `audit_log` takes a row
for every admin mutation. `person` and `attendance` are the register;
`feedback` the widget's store; `scan_submission` the crowd-scan approval
queue; `label_print` and `booklet` the paper trail for printed labels and
produced PDFs; `loan` the out/back register (H5).

**`piece.season` becomes a controlled vocabulary** — 19 tags in church-year
order, in `src/church.config.ts`. Deliberately *not* a database CHECK: the
column holds a semicolon-joined list, so a constraint could only match the
whole string, and a rejected write tells nobody anything. `readSeasons()`
in `src/normalise.ts` folds case, spacing, commas and the synonyms the
choir actually uses ("Whitsun" → `pentecost`), and hands back anything it
does not recognise **verbatim** rather than dropping it. The importer turns
that into a review flag naming the word somebody actually wrote. Every one
of the 19 tags in the committed index falls inside the vocabulary, and a
test asserts it stays that way.

**The importer reads the v2 columns.** `composer_full`, `surname` and
`season` now land on the piece, and the planner compares them — without
that they would import once and then never update, because a row with a
corrected season would be called "unchanged". A v1 cut with none of these
columns still imports, storing NULL rather than empty string.

Tests: 108, up from 66. New coverage on the season vocabulary, the v2
columns, and every constraint in 0002 that carries a decision — including
that SQLite would accept each `ALTER TABLE ADD COLUMN` (no UNIQUE, no
PRIMARY KEY, a default behind any NOT NULL), which otherwise fails at
migrate time against the live database rather than in CI.

### Milestone 4 — service feed and matcher

Taken before milestones 2 and 3 because both depend on services existing:
the choir home screen, the copies RAG and the sung-at history are all
downstream of this.

**The feed contract turned out to be readable.** The brief assumed it was
not reachable from this session, so it would have to be guessed at. It is
not: the live feed answers, and `docs/FEED.md` now records what it
actually serves, including that it publishes a `sourceHash` — which is
exactly the hash-gate the brief asked for, already computed upstream.

**`src/feed.ts`** reads a month into services and music lines. Pure, and
treats the feed as untrusted input: it is written by a language model
reading a Word document, and currently carries "Wiliam Byrd", "Tomas
luis da Vittoria" and a choir called "RCSM". A service it cannot read is
skipped with a reason rather than costing the other thirty-nine.

**`src/matcher.ts`** decides what a line means. The slot drives the
reading — "Bernard Rose" is a composer in the responses column and a
title in the anthem column, and the feed has already told us which
column it came from. Also pure, which is what lets it be tested against
real lines rather than tidied-up ones.

**`src/services.ts`** is the D1 half: upsert, ingest, confirm, reject.
A confirmed match survives a re-fetch — lines are compared on slot and
raw text rather than position, so somebody fixing a typo in the Word
file cannot undo James confirming forty lines.

**The hourly cron** (`[triggers]` in `wrangler.toml`) reads this month
and next. An unchanged month writes nothing at all.

Measured against four real months of the feed: **48% matched
automatically**, the rest one tap each. That number is deliberately not
higher — an earlier scoring rule reached 61% *and* pointed a Stanford
anthem at the wrong Stanford parcel and a Handel introit at the wrong
Handel one, both because shared words were scored against the shorter of
the two titles rather than against the line's own. Both are regression
tests now. Every confirmation is written to `match_alias` and reused
outright, so the rate climbs by itself.

`src/audit.ts` arrives here rather than in milestone 3, because the feed
routes are the first admin mutations that need it.

### Milestone 0 — CI green against index v2

Index v2 landed on `main` in 79b3930 with 410 rows where v1 had 324, and
69 multi-title parcels where v1 had 65; the seed tests hard-coded both.
The counts now sit in two named constants, so the next re-cut is a
two-line edit. Three committed `.DS_Store` files removed and gitignored.

---

## Session 1 — Phase 0: scaffold, schema, seed, portal

The first working session. bmmusic starts as an empty repository holding
one thing of value: `data/seed/bm-music-draft-index.csv`, 324 draft rows
read off photographs of the parcel and box labels in the song school.
This session builds the app around it.

**Scaffold.** A single Cloudflare Worker on Hono, server-rendered, no
client framework and no CDN assets, following `fobm-vestry` — the
estate's UI and auth template. `src/church.config.ts` carries every
Minster-specific fact and `src/theme.ts` the design tokens, per
`docs/ESTATE.md`; a fork for another church edits those two files and
nothing else. Bindings are named in `wrangler.toml` and configured in
the Cloudflare dashboard, never committed.

**Auth — two gates, deliberately different.** The choir side sits behind
a shared password with an HMAC-signed session cookie, rotated each term
by changing one secret. `/admin` sits behind Cloudflare Access
pass-through, with the Worker checking for the Access assertion as
defence in depth rather than trusting the path. Noindex headers on every
response and a `robots.txt` that disallows everything: this catalogue is
not for the public, and the physical library it describes is not
something to advertise the location of.

**Schema.** Seven tables in `migrations/0001_initial.sql` — `piece` as
the spine, plus `alias`, `holding`, `file`, `performance`,
`choir_profile` and `repair_job`. Two decisions worth recording:

- `accession` is nullable and unique. The library has never had accession
  numbers; assigning them is a deliberate human act in catalogue order,
  not something the importer should invent. A piece with no accession is
  a normal piece, not a broken one.
- `legacy_ref` holds the CSV's draft reference (`D-001`) under a unique
  index. That is what makes re-importing safe, and it keeps a thread back
  to the source photograph after the numbers are assigned.

**Seed importer.** Parses the committed CSV, maps its loose draft
categories onto the schema's category codes, and writes one `piece` per
row — multi-title rows (65 of the 324) keep their joined title verbatim
and gain one `alias` per title, so a music list naming just
"O sing joyfully" still finds the Batten parcel. Confidence and flags
carry into `review_flag`; nothing from the seed reaches the choir as
settled fact without a human confirming it.

Idempotency is the property that matters, because James will replace the
CSV with a better cut and re-run: the import is keyed on `legacy_ref`,
refreshes rows nobody has reviewed yet, and leaves reviewed rows alone
entirely. Re-running an unchanged file is a no-op — 324 unchanged, 0
inserted.

**Screens.** Choir side: browse and search by composer, title, category
and voicing, and an item page with holdings and marked placeholders for
PDF viewing and performance history (both Phase 1). Admin: the seed
review queue, one-click sequential accession assignment, an item editor,
and a photo-intake screen following vestry's upload → extract → review →
confirm pattern. The extraction call degrades to manual entry when
`ANTHROPIC_API_KEY` is unset rather than presenting a broken screen —
the volunteers doing this work should never meet an error page.

**Volunteer portal.** Look up by accession or composer/title, then a
phone-sized form: copies total, copies usable, condition, voicing seen,
note. It writes a `holding` row, flags the piece for review when the
count contradicts what is recorded, and prompts "set one copy aside for
scanning" — the scanning backlog is the point of the count.

**R2.** The `bmmusic-scans` bucket does not exist yet; the README says
to create it at deploy time with a Western Europe location. The
streaming route is written and gated, so it works the moment the bucket
is bound.

66 tests: the schema's shape against the specification (every column
the brief names, and the constraints carrying a decision), the CSV
reader, the category mapping, the import planner — including a
full-file idempotency run over the real committed seed — the session
cookie and password gate, and accession formatting.

Verified against a real D1 besides: the migration applies, the import
writes 324 pieces and 166 aliases, re-running reports 324 unchanged,
and after confirming three rows by hand a third run reports them
"already confirmed and left alone" with the edits intact. The admin
gate was checked in `access` mode too — every `/admin` route answers
403 without a Cloudflare Access assertion, including for a signed-in
chorister.

Not in this phase: PDF viewing, performance history, YouTube mining,
booklet building, and the pinch-point warnings that will join
`bmserviceapp`'s music-list API to these copy counts.
