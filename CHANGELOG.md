# Changelog

Reverse-chronological, by merge date. Each entry names the pull request it
landed in, so the diff is one click away.

**This file records decisions, not changes.** The full reasoning for each one
is in the PR body, next to the code it explains; what is kept here is the
short version of anything a future change might otherwise undo without
realising what it was for. Where a decision is about *which way to be wrong*,
that is the part worth reading.

---

## 2026-08-28 — It should look like an app

The interface reworked to read as an app rather than as a printed document,
plus two vocabulary decisions.

- **A tab strip is the navigation.** Four destinations choir-side, nine on the
  admin side, in the same place on every page with the current one marked. It
  **scrolls sideways rather than wrapping**, because a nav that wraps changes
  height between pages and shifts the content under it every time you navigate.
  The current tab is **derived from the path**, not passed by each page: that
  is what stopped nearly forty call sites acquiring a `nav` key that would only
  ever go stale.
- **Glyphs are drawn in the repository** (`src/icons.ts`, ~30 inline SVG paths).
  No icon font and no package — CDN assets are ruled out here, and an icon that
  fetches anything is an icon that is sometimes a blank square in a song school
  with one bar of signal. `currentColor` and `aria-hidden` throughout, so a
  glyph is correct in the dark theme and inside a red button with no extra rule,
  and a screen reader does not read the label beside it twice.
- **Buttons name their font.** A `<button>` does not inherit the page's
  typeface, so until this every button in the app was set in the browser's own
  UI face rather than the one everything else is set in — the sort of thing
  that makes a page look untended without anybody being able to say why.
- **Corners are rounded, 6→16px by role**, against the estate's single 2px.
  A deliberate departure: sharp corners read as printed matter, which is a
  defensible register for a church and the wrong one for a thing used
  one-handed on a phone by children.
- **There is no blue.** Blue is not a Minster brand colour. The estate's focus
  ring was `#1A6FB5`, and it was chosen well — a hue nobody else uses always
  reads as *the keyboard is here* rather than as decoration — so it had to be
  replaced rather than deleted. The ring is now **two-tone rather than
  coloured**: dark with a light halo, reversed in the dark theme, which is
  legible on cream, on white, on a red button and on a dark page alike. No
  single hue manages that, and a second brand colour would not have been
  available anyway — red, gold, green and violet are all spoken for. A test
  fails if a blue reappears in either palette.
  - The **one** blue left is the Marian season rule. It is liturgical, not
    brand, it matches bmserviceapp so both apps paint the same rule on the
    same day, and the test asserts it is the only one.
- **The wordmark wraps rather than truncates on a phone.** "Beverley Minster
  Music" beside three controls on a 360px screen truncated to "Beverley
  Minster …", which loses the only word saying which Minster app this is. Below
  30rem the crest gives way to the words and the words take two lines.
- **The two sides are named differently**: `Beverley Minster Music` choir-side,
  `BM Music Admin` behind Access. Somebody cataloguing has both open, and the
  tab where a wrong click writes to the register should be identifiable without
  reading twice.
- **A padlock in the choir masthead leads to the admin side.** For almost
  everybody it opens onto a Cloudflare Access screen they cannot pass, which is
  the point: the gate is the gate whether or not there is a sign on it, and it
  saves the one person who can from typing the path by hand.

### Two vocabulary decisions

- **"Box", for everything.** The anthems are in wrapped parcels and the service
  settings are in boxes, and the app said both. It now says box throughout: one
  word for one idea, because a volunteer holding the thing does not care which
  it technically is and should not have to guess which word the screen will
  use. Prose only — every `parcel` in the SQL was a comment, so no schema or
  data changed.
- **The cupboards are named after diesel locomotive classes** — Deltic,
  Western, Warship, Peak, Hymek, Whistler, Growler, Duff. Robert's idea, and it
  earns its place: "it's in Deltic" survives being called across a song school
  where "it's in D" is heard as "in B".
  - **The letter is stored; the name is only displayed.** Every
    `holding.location_door`, every label already stuck to a spine and every
    volunteer who has learned the wall carries the letter. So renaming a
    cupboard — or removing the joke — is an edit to `CHURCH.storage.doors` and
    nothing else: no migration, no reprint, no recount. `test/storage.test.ts`
    asserts `isDoorLetter("Deltic")` is false, which is what stops a name ever
    becoming a stored value.

## 2026-08-27 — Addendum A: modules, roles, the register ([#12](https://github.com/JamesCAPalmer/bmmusic/pull/12))

The music department's register — attendance driving quarterly pay,
safeguarding duties, school years, award dates and parent telephone numbers —
absorbed as switchable modules, with children's data treated as a class apart.
Migrations `0003` and `0004`.

- **Everything holding a person's name ships switched off.** Eight modules;
  library and services on, the six touching a person dark until somebody turns
  them on. A disabled module answers **404, not 403** — a 403 says "there is
  something here and you may not have it", which is a fact about the choir
  worth not publishing.
- **Roles are a separate question from Access.** Access decides who reaches
  `/admin`; roles decide what is there when they do. Six people hold a
  Librarian policy so the library can be catalogued, and none of that is a
  reason to hand them the register. Both are checked in **one middleware over
  `/admin`**, so a new route is gated by existing rather than by somebody
  remembering, and `requiredRolesFor` **fails closed** on a path it does not
  know.
- **Every route rendering a child's name lives under `/admin/people*` or
  `/admin/safeguarding*`** and nowhere else, so a second and tighter Access
  application can be scoped to those two prefixes without moving anything.
  The register moved from `/admin/register/*` for this.
- **Parent contacts are the hard gate.** Their own table, so every ordinary
  `SELECT` from `person` is safe by construction. No GET returns one — reading
  a number is a POST, because a bookmarkable URL showing a child's parent's
  telephone number must not exist — and the audit line is written *before* the
  read, so a look that cannot be recorded does not happen. One export in the
  app carries a number; it is music staff only and separately audited.
- **A school year, never a date of birth.** The app is not given the means to
  compute an age, so it cannot leak one.
- **Money is pence, and a rate is a row with a date.** The rate is looked up
  per service, not per quarter, so a quarter straddling a change is right on
  its own. A missing rate is null, not zero — pricing an unrated service at
  nought short-changes somebody silently.
- **No adult-to-child ratio ships.** What is acceptable is the Minster's
  safeguarding policy to state, not software's to decide, so that one check is
  silent until a figure is set. The rest of the coverage check is not: a backup
  is not cover, an expired DBS is red and named, a *missing* one is only amber
  — not knowing is not knowing, and treating the two alike trains people to
  ignore the red ones.
- **The collection tick cannot be un-ticked.** "They had all gone, and then
  they had not" is not a state the record should hold.
- **Migration 0003 rebuilds `person` and carries the register across by hand.**
  Dropping `person` fires an implicit `DELETE FROM` and `attendance` cascades.
  Neither `PRAGMA foreign_keys=OFF` nor `legacy_alter_table=ON` prevents that
  inside wrangler's transaction — both were measured, both lost every
  attendance row. `test/migrations.test.ts` now permits a `DROP TABLE` only as
  one half of a rebuild, and refuses one that drops `person` without restoring
  `attendance`.
- **Nightly backup** of every table to R2 as JSONL, 35 days' retention, on top
  of D1 Time Travel's 30. Retention deletes on a parsed date and nothing else,
  because the bucket also holds every scan in the library. Nothing about the
  contents is logged, and **no route reads a backup** — restoring is a person
  with a terminal (`docs/RESTORE.md`).
- **The workbook importer writes nothing until a person has looked.** A row
  whose sheet did not name a choir is never written; a discarded upload is
  deleted outright, names and all. `src/xlsx.ts` reads .xlsx without a
  dependency and keeps blank cells in their columns and blank rows in their
  numbering — Excel writes nothing for either, and a reader that appends as it
  goes misfiles every column after a gap.
- **Nothing is seeded**: no people, no parent contacts, no pay rates.

Two gate bugs found while building on it, both fixed with a rule and a test:
`/admin/people/pay.csv` resolved to the wrong module (the prefix boundary now
counts `.` as well as `/`), and `/admin/people/:id` was declared above
`/admin/people/pay` and swallowed it (Hono matches in declaration order).

Tests 294 → 437.

## 2026-08-27 — The estate look ([#10](https://github.com/JamesCAPalmer/bmmusic/pull/10))

The app uses the estate's actual design language rather than an approximation.

- **The palette was read off the deployed hub, not guessed.** The other estate
  repos were unreachable from the session, but bmserviceapp is deployed and a
  deployed app wears its design language on its face. `test/theme.test.ts` pins
  every value so a well-meaning tweak cannot quietly make the two apps
  different colours.
- **Served by this Worker, never a CDN.** `CLAUDE.md` rules CDN assets out and
  the reason is in the same sentence — a phone in a cold song school with one
  bar of signal. 143 KB of assets behind a one-year immutable cache; one
  download per device, ever.
- `/asset/*` becomes the only unauthenticated path, because the sign-in page
  needs the logo before there is a session. A logo and a type face reveal
  nothing about the library.
- A dark theme, which the estate had and this app did not; one radius (`2px`)
  everywhere; red for identity, gold for what wants a second glance.
- Two faults found only by rendering the pages: the sign-in page had no crest,
  and a Eucharist's four hymns took a row each and pushed the anthem off a
  phone.

## 2026-08-27 — Labels, QR, people, the picker, and choir sizes ([#8](https://github.com/JamesCAPalmer/bmmusic/pull/8))

- **Label geometry lives in `church.config.ts` in millimetres** — what the
  packaging says and what James will measure with. A test asserting the grid
  fits its page caught a real error while being written: a 7.2mm left margin
  made two 99.1mm columns plus a gap 5mm wider than A4.
- **Every label file starts with a calibration page.** Finding out after 410
  sheets that the printer is 3mm out is an expensive way to learn it.
- **The QR encodes `/q/{accession}`, not `/piece/{id}`.** The accession is
  written on the parcel in ink; a database id could be renumbered by a
  re-import, and four hundred parcels cannot be reprinted.
- **Category glyphs are drawn as paths, not set in a font**, so they print on a
  mono laser exactly as authored. Glyph *and* letter: the glyph is quick to
  spot along a shelf, the letter survives a label gone brown.
- **The register is absent from the audit log** — verified live, not merely
  intended. Adding people wrote `person.add → "one added to satb"`, never a
  name; marking a register wrote nothing at all.
- **Choir sizes: overestimating is safer than underestimating.** Too many
  singers means the RAG cries "not enough copies" and somebody checks; too few
  means a chorister arrives to no copy. So a bare `SATB` reads as all 33 adults
  rather than one team.
- **An unknown group makes the whole answer unknown.** A designation naming a
  visiting choir returns nothing and shows grey, because a partial count would
  be a confident green against a number certainly too low.
- **The Junior Choir is deliberately not counted** — they do not sing from
  copies, so they can never make a parcel short.

## 2026-08-27 — The admin refit ([#7](https://github.com/JamesCAPalmer/bmmusic/pull/7))

- Admin home becomes tiles with the queues above the doors — a tile with forty
  items behind it should not look like one with nothing.
- **One "New catalogue item"** with both modes side by side, because somebody
  who starts with a scan and finds the reading poor just carries on typing.
- **In bulk edit, a blank box means "leave alone", never "clear".** The
  opposite would let one careless click wipe the season tags off two hundred
  rows with no undo.
- **The choir password is a salted PBKDF2 hash in `app_setting`, never in the
  clear** — `minster-data` is a shared database. Changing it bumps a
  `password_generation` counter mixed into the session cookie's signing key, so
  every cookie already issued stops verifying. That is what makes the termly
  rotation actually rotate.
- **Statistics come from confirmed matches only.** A year's figures built on
  the matcher's proposals would look authoritative and be partly guesswork.
- **Easter is computed properly** (Meeus/Jones/Butcher), checked 2024–2285,
  because everything from Ash Wednesday to Pentecost counts from it and a week
  out puts the whole Passiontide shelf in the wrong month.

## 2026-08-27 — The choir side ([#6](https://github.com/JamesCAPalmer/bmmusic/pull/6))

- **Home leads with the next service and its music already open**, because
  somebody opening this on the bus is nearly always asking "what's on tonight
  and have I looked at the anthem?". Browse moves from `/` to `/music`.
- **The copies RAG is grey when either number is unknown.** Making unknown look
  like green would fill the screen with reassuring ticks that mean nothing, and
  the first time it mattered would be the morning somebody found nine copies
  for twenty singers.
- **The feedback widget has no name field and no email field.** This is a
  choir-side app used by children; James needs to know a page is broken, not
  who noticed. The honeypot answers 204, so a bot learns nothing.
- **Crowd scans land pending and invisible.** That gate is the feature — these
  are photographs of somebody's marked-up copy.
- Working copies are cached in R2 on a hash of exactly which scans went in, so
  tapping twice costs one PDF while a newly approved scan still rebuilds.
- Flagged at the time and still open: hymn numbers in the live feed run 9–565
  but the descant binders only cover 1–150, so the finder declines for about
  two-thirds of real hymns. The range is config.

## 2026-08-27 — Service feed and the learning matcher ([#5](https://github.com/JamesCAPalmer/bmmusic/pull/5))

Taken before the choir and admin milestones because both depend on services
existing.

- **The feed contract turned out to be readable.** The brief assumed it was not
  reachable and would have to be guessed at; the live feed answers, and
  `docs/FEED.md` records what it actually serves — including a `sourceHash`,
  which is the hash-gate the brief asked for, already computed upstream.
- **The feed is treated as untrusted input.** It is written by a language model
  reading a Word document and currently carries "Wiliam Byrd" and a choir
  called "RCSM". A service it cannot read is skipped with a reason rather than
  costing the other thirty-nine.
- **A confirmed match survives a re-fetch** — lines are compared on slot and
  raw text rather than position, so fixing a typo in the Word file cannot undo
  James confirming forty lines.
- **48% matched automatically, and that number is deliberately not higher.** An
  earlier scoring rule reached 61% *and* pointed a Stanford anthem at the wrong
  Stanford parcel, because shared words were scored against the shorter of the
  two titles rather than against the line's own. Both are regression tests.
- Every confirmation is written to `match_alias` and reused, so the rate climbs
  by itself.

## 2026-08-27 — Schema migration 2 ([#4](https://github.com/JamesCAPalmer/bmmusic/pull/4))

`migrations/0002_build2.sql`, additive only — 0001 had already run against
`minster-data`, and what is in it is the product of somebody's afternoons in a
cold song school.

- **Door and shelf are two columns, not one string.** "What is on door C?" is a
  question the sheet run answers by sorting, and 0001's free-text `location`
  cannot be sorted usefully.
- **`piece.season` is a controlled vocabulary but deliberately not a database
  CHECK.** The column holds a semicolon-joined list, so a constraint could only
  match the whole string, and a rejected write tells nobody anything. Unknown
  words are kept **verbatim** and turned into a review flag naming what
  somebody actually wrote.
- The importer compares the v2 columns as well as writing them — without that
  they would import once and never update, because a row with a corrected
  season would be called "unchanged".
- A test asserts SQLite would accept each `ALTER TABLE ADD COLUMN`, which
  otherwise fails at migrate time against the live database rather than in CI.

## 2026-08-27 — CI green against draft index v2 ([#3](https://github.com/JamesCAPalmer/bmmusic/pull/3))

Index v2 landed with 410 rows where v1 had 324, and 69 multi-title parcels
where v1 had 65; the seed tests hard-coded both. The counts now sit in two
named constants, so the next re-cut is a two-line edit.

## 2026-08-26 — CI workflow, and the scans bucket in the EU ([#2](https://github.com/JamesCAPalmer/bmmusic/pull/2))

`.github/workflows/ci.yml`, and `bmmusic-scans` bound with EU jurisdiction —
the bucket holds scans of music the choir has marked up, and it stays in the
EU.

## 2026-08-26 — Phase 0: scaffold, schema, seed, portal ([#1](https://github.com/JamesCAPalmer/bmmusic/pull/1))

The app built around one thing of value: `data/seed/bm-music-draft-index.csv`,
draft rows read off photographs of the parcel labels.

- **Two gates, deliberately different.** The choir side is one shared password
  with an HMAC-signed cookie, rotated each term by changing one secret;
  `/admin` is Cloudflare Access, with the Worker checking for the assertion as
  defence in depth rather than trusting the path.
- **`accession` is nullable and unique.** The library has never had accession
  numbers; assigning them is a deliberate human act in catalogue order, not
  something the importer should invent. A piece without one is normal, not
  broken.
- **`legacy_ref` is unique**, which is what makes re-importing safe and keeps a
  thread back to the source photograph.
- **The importer is idempotent** — keyed on `legacy_ref`, refreshes unreviewed
  rows, leaves reviewed ones alone entirely. James will replace the CSV with a
  better cut and re-run.
- **Multi-title parcels keep their joined title verbatim and gain one alias per
  title**, so a music list naming just "O sing joyfully" still finds the Batten
  parcel.
- **Nothing from the seed reaches the choir as settled fact without a human
  confirming it.**
- **Extraction degrades to manual entry** when `ANTHROPIC_API_KEY` is unset —
  the volunteers doing this work should never meet an error page.
