# bmmusic — the Minster music library

A private catalogue of the physical music library at Beverley Minster: roughly
500–600 boxes of music in the song school, behind eight cupboards named after
diesel locomotive classes. It records what we have, how many copies, and what state
they are in — and gives the choir a way to look a piece up without opening a
cupboard. Since Addendum A it also runs the choir: the register, attendance,
quarterly pay and the safeguarding duty rota.

Part of the [Beverley Minster app estate](https://github.com/JamesCAPalmer/bmserviceapp/blob/main/docs/ESTATE.md).
A single Cloudflare Worker (Hono, server-rendered, no client framework) at
`bmmusic.james-palmer.com`, with D1 for the catalogue and R2 for scans.

**There are no public pages.** The choir side is behind a shared password,
`/admin` is behind Cloudflare Access, every response carries noindex headers,
and `robots.txt` disallows everything. The one unauthenticated path is
`/asset/*` — the Minster logo and the two type faces, which the sign-in page
needs before there is a session and which reveal nothing about the library.

| | |
| --- | --- |
| **Deploying, and shipping a change** | [docs/DEPLOY.md](./docs/DEPLOY.md) |
| **Getting data back** | [docs/RESTORE.md](./docs/RESTORE.md) |
| **How music gets into the catalogue** | [docs/PIPELINE.md](./docs/PIPELINE.md) |
| **The service feed contract** | [docs/FEED.md](./docs/FEED.md) |

> **Merging to `main` deploys and migrates by itself.** Workers Builds ships
> the code; `.github/workflows/migrate.yml` applies pending D1 migrations and
> checks the tables landed. If the schema ever falls behind the code, every
> gated page 500s — so if that workflow goes red, look at it first. See
> [DEPLOY.md](./docs/DEPLOY.md#migrations-and-why-they-matter-more-than-they-look).

---

## What is here

| | |
| --- | --- |
| **Choir** | A home screen showing the next service with its music list and copies RAG; browse and search by composer, title, category and voicing; a piece page with copy counts, season, where the box lives, when we last sang it, and its reference scans. A descant finder. |
| **Volunteers** | A phone-shaped portal for counting a box: totals, condition, voicing, notes. |
| **Librarian** (`/admin`) | A date-aware **Today** front page, then the review queue for draft entries, the music-list match queue, the crowd-scan approval queue, feedback, accession numbering, an item editor, photo intake, label printing, loans, reports and the draft-index importer — all of it filed under **More**. |
| **Music staff** (`/admin`) | The choir list and each person's record, the register, attendance totals, the quarterly pay run, the safeguarding duty rota, exports, and the workbook importer. |

Everything in the last row is behind a [module switch that ships off](#modules).

Services and their music lists arrive from bmserviceapp's feed on an hourly
cron. bmmusic never fetches or parses the Minster's music-list document itself
— see [docs/FEED.md](./docs/FEED.md), and the [data boundary](#data-boundary).

Three schedules run, told apart in `scheduled()` by their cron expression: the
feed read at half past every hour, the backup at 02:15, and the school-year
rollover at 03:00 on 1 September. All UTC; all declared in `wrangler.toml`.

### Beta features

Marked with an amber **beta** chip, and built to fail soft: if one of these
cannot do its job it says so in a sentence and the rest of the page carries on.

- **Working copies** — a service's approved reference scans joined into one
  watermarked PDF for rehearsal.
- **Scan this with your phone** — a chorister photographs a copy; it is
  invisible to everybody else until an admin approves it.
- **Everything the register brought with it** — the choir list, attendance,
  pay, the duty rota, exports and the workbook importer.

The chip's tooltip says what to do about it: *new this term — tell us what is
wrong with the feedback button*.

Not yet built: the OCR bulk-update pipeline for returned volunteer sheets, the
reference-scan campaigns, listen links (waiting on the YouTube backfill), the
proper booklet builder with the Minster cover template, and the wardrobe,
awards and junior-choir screens — those three have module switches already, so
their routes 404 until there is something behind them.

## Layout

```
src/church.config.ts   every Minster-specific fact (estate pattern — pure data)
src/theme.ts           design tokens, separate from layout (estate pattern)
src/icons.ts           the glyph set, as inline SVG (pure, no dependency)
src/env.ts             the Worker's bindings, and the shared Hono env type
src/index.ts           routes, and the three cron handlers
src/ui.ts              the choir-side pages, the masthead and the tab strip
src/ui-admin.ts        the admin pages
src/assets.ts          the estate's logo, icons and type faces, served locally
src/text-modules.d.ts  lets the draft index bundle as a text module

  the gate
src/auth.ts            the choir password gate and the Access gate
src/modules.ts         which parts of the app exist at all (pure)
src/roles.ts           who may reach which path (pure)
src/password.ts        the self-service choir password
src/audit.ts           who changed what

  the library
src/catalogue.ts       the catalogue's D1
src/storage.ts         cupboards and shelves — how a box's address reads (pure)
src/seed.ts            the draft-index importer
src/normalise.ts       season vocabulary and canonical forms (pure)
src/reports.ts         coverage, what gets sung, the priority queues
src/labels.ts          label geometry, category glyphs and the QR (pure)
src/labelsheet.ts      drawing the two label stocks
src/submissions.ts     crowd scans, feedback and booklets
src/workingcopy.ts     joining reference scans into one PDF
src/extract.ts         label reading (Anthropic), and its fallback
src/anthropic.ts       the API client
src/csv.ts             a small RFC 4180 reader and writer (pure)

  services and music lists
src/feed.ts            reading bmserviceapp's music feed (pure)
src/matcher.ts         matching a music-list line to a box (pure)
src/services.ts        services, music lists and the matcher's memory — the D1 half
src/churchyear.ts      Easter, and which seasons are in play (pure)
src/rag.ts             the copies RAG (pure)
src/choirsize.ts       how many singers a designation means (pure)
src/descants.ts        which binder holds a hymn descant (pure)

  the choir
src/people.ts          people, the register, parent contacts (personal data)
src/duty.ts            the safeguarding rota and its coverage rules (pure + D1)
src/pay.ts             quarters, rates and the pay run (pure + D1)
src/importer.ts        reading the department's workbook (pure + D1)
src/xlsx.ts            enough of .xlsx to read it, with no dependency (pure)
src/backup.ts          the nightly dump to R2, and retention (pure + D1)

assets/                the logo and type faces — bundled, never fetched
migrations/            the D1 schema
data/seed/             the committed draft index
docs/                  DEPLOY, RESTORE, PIPELINE, FEED
```

The pure modules hold no D1 and make no network calls, which is what lets them
be tested directly: the matcher against real feed lines rather than tidied-up
examples, the label geometry against the real stock dimensions, and the duty
coverage rules against every way a rota can be wrong.

A fork of this app for another church edits `church.config.ts` and `theme.ts`
and nothing else. If a third file needs touching, a fact has leaked out of
config and should go back.

## How it looks, and why

It is meant to read as an app rather than as a printed document, because that
is what it is: used one-handed, on a phone, in a cold song school, by children.
Four decisions carry most of that, and each is enforced by a test rather than
left to taste.

**A tab strip, on every page.** Four destinations choir-side — Services,
Library, Descants, Count a box — and **at most six** on the admin side: Today,
Review, Search, The choir, Duty rota, More. The same row in the same place with
the current one marked is the single thing that makes an app navigable without a
map. It scrolls sideways rather than wrapping so the page below never shifts,
and below 30rem the labels drop away from all but the current tab and the glyphs
carry it. Which tab is current is derived from the path, so a new page gets it
right without being told.

The admin strip is **filtered by the same gate the request came through**: a
librarian is never shown a tab to the choir, and somebody on the safeguarding
rota is never shown one to the catalogue. A tab that answers 403 teaches
somebody the app is broken; a tab that is not there teaches them nothing at all,
which is correct. See [Focus](#focus-today-and-more).

## Focus: Today, and More

The admin front page used to offer twenty-three tiles across four sections, plus
a statistics grid, plus the accession run, above a strip of nine tabs. Every one
of those was a decided need — but somebody opening the app for the first time on
the first Thursday of term should see three things, not twenty-three.

So `/admin` is now **Today**, and it answers one question in order:

1. **The next event** — its date, its designation, who is covering each duty and
   where the gaps are, and one big **Open the register** button. If it is today,
   it says so loudly.
2. **Waiting for you** — the same queue tiles as before, but only the ones with
   a non-zero count. A tile reading "0 scans sent in" is furniture, and furniture
   teaches people to stop reading the section it is in.
3. **The usual things** — at most six: New item, Search, Print labels, The
   choir, Duty rota, More.

**`/admin/more` is where everything else was filed, and nothing was deleted.**
The same groups, the same tiles, plus the four screens that used to be tabs
(Music lists, Scans, What to do next, Reports) and the statistics and accession
run that used to sit under the tiles. `test/pilot.test.ts` reads every declared
admin route out of `src/index.ts` and fails if one of them is linked from
nowhere — a route that answers but that nobody can click is a feature deleted
without anybody deciding to delete it.

**`/admin/guide`** is one page: the register, the rota and the library, with
three steps each, written for the job rather than the person doing it. A welcome
card on Today links to it once per admin and then goes away for good — dismissed
against that person's own email in `app_setting`, so one person putting it away
does not put it away for everybody.

## The door register

`/admin/people/register/:id` is the screen the pilot is judged on. It is used
one-handed on an iPhone, at a vestry door, by a duty adult in a cassock, with
the other hand holding a door open and the Minster's signal coming and going.
Everything about it follows from that sentence:

- **The whole row is the control** — 56px tall, edge to edge, not a small
  control inside a row.
- **Colour and shape, never colour alone.** Here, away and excused each carry a
  glyph and a word as well as a colour, so the three are told apart by somebody
  colour-blind, in bad light, and on a photocopy.
- **"12 of 18 marked"**, at the top, updated as you go.
- **It saves each tap and says so.** With script it is one tap and no page load;
  without script — or the moment the fetch fails, which on that signal it will —
  the same form posts the ordinary way and the page comes back. Nothing is
  queued in the browser, so a phone that loses signal loses at most the tap in
  flight.
- **Group tabs** (Boys, Girls, …) pre-picked from the event's designation when
  it names exactly one choir, and "everybody" when it names two — pre-picking
  one of two would hide half a register from somebody who did not ask it to.
  The sections are all present without script; the tabs appear only once the
  script that gives them meaning has run.
- **The dismissal tick is at the bottom of the same screen**, because it is the
  last thing that happens at the same door on the same phone in the same five
  minutes.

**Glyphs, drawn here.** `src/icons.ts` is about thirty inline SVG paths on a
24×24 grid. No icon font and no package: CDN assets are ruled out, and an icon
that fetches anything is an icon that is sometimes a blank square on one bar of
signal. Every glyph is `currentColor` and `aria-hidden`, because each one sits
beside a label that already says the same thing.

**Rounded corners, and the sans face on anything you tap.** The radius scale
runs 6→16px by role — chip, input, button, card — rather than one value
everywhere. Buttons name the sans face explicitly: a `<button>` does not
inherit the page's font, so without that line every button in the app was set
in the browser's own UI face. The display serif stays where it belongs, on the
music: piece titles, composers, headings.

**No blue.** Blue is not a Minster colour. The estate's focus ring was
`#1A6FB5` and it was there for a good reason — a hue nobody else uses always
reads as *the keyboard is here* — so removing it meant replacing it rather than
deleting it. The ring is two-tone instead: dark with a light halo, reversed in
the dark theme, legible on cream, on white, on a red button and on a dark page.
`test/theme.test.ts` fails if a blue ever reappears in either palette. The one
exception is the Marian season rule, which is liturgical rather than brand and
is asserted as the *only* blue in the file.

**No bare empty tables.** Every list screen with no rows says what to do next in
one sentence, with the one right link — an empty choir list points at the
workbook importer, an empty rota at the form that adds the term's events. A
table with no rows tells somebody opening the app on the first Thursday of term
either that they have done something wrong or that the thing is broken, and both
are worse than the truth. `nothingYet()` in `src/ui.ts` is the one shape they
all take.

**The category glyph, choir-side.** The eight shapes printed on the box labels —
moon, sunrise, bread, voices, harp, star, quaver, book — now appear before the
title in piece lists and search results, drawn from the same table in
`src/labels.ts` that the printer draws from, so the screen and the label can
never disagree. A piece with no category gets the fallback at reduced opacity
rather than being told what it is.

## Say "box", and the cupboards have names

**Box.** The anthems are physically in wrapped parcels and the service settings
are in boxes; the app used to say both, and now says *box* for everything. One
word for one idea — a volunteer holding the thing should not have to work out
which word the screen will use. Nothing in the database changed; this was
always prose.

**The cupboards are diesel locomotive classes** — Deltic, Western, Warship,
Peak, Hymek, Whistler, Growler, Duff, one per door, in `CHURCH.storage.doors`.
Robert's idea, and a good one: "it's in Deltic" survives being called across a
song school in a way that "it's in D" does not, because a name is memorable
exactly where a letter is confusable.

The letter is what is stored, printed on every label and painted on the doors;
the name is display only, and `src/storage.ts` is the one place that joins them
(`A · Deltic`). So renaming a cupboard, or dropping the joke entirely, is an
edit to that one array — no migration, no reprint, no recount.
`test/storage.test.ts` holds that line: it asserts `isDoorLetter("Deltic")` is
false, so a name can never become a stored value.

## Working on it

```sh
npm install
npm run typecheck
npm test
npm run migrate:local     # apply migrations to the local D1
npm run dev
```

For local development put the secrets in `.dev.vars` (git-ignored, never
committed):

```
CHOIR_PASSWORD="something for local use only"
SESSION_SECRET="anything long and random"
ADMIN_MODE="local"
# ANTHROPIC_API_KEY="sk-ant-..."   optional; without it intake takes manual entry
```

`ADMIN_MODE="local"` opens `/admin` without Cloudflare Access **and grants all
three in-app roles**, so the screens are reachable while you work on them. It
must never be set in production — the deployed `wrangler.toml` sets `"access"`.
To exercise the real gate locally, set `ADMIN_MODE="access"` and send
`Cf-Access-Jwt-Assertion` and `Cf-Access-Authenticated-User-Email` headers by
hand.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:
typecheck (Worker and tests separately), the Vitest suite, `migrations/` applied
to a local D1, and `wrangler deploy --dry-run` to prove the Worker still bundles
and `wrangler.toml` still parses.

The last two are there because the first two cannot see them: the migration
tests read the SQL as text, so only applying it proves SQLite accepts it, and
nothing else would catch the draft index failing to bundle as a text module.

It needs no secrets and no Cloudflare credentials — every step runs locally to
the runner, and a dry run deploys nothing. `npm run typecheck && npm test` is
the same thing you run before pushing.

**CI does not deploy and does not migrate.** See
[DEPLOY.md](./docs/DEPLOY.md#shipping-a-change).

---

## Modules

Eight of them, switched from `/admin/modules` by music staff, every flip
audited. The library and the services ship **on** because they are what this
app already was. **Everything that holds a person's name ships off** and stays
off until somebody deliberately turns it on.

| Module | Holds names | Ships |
| --- | --- | --- |
| `library` | no | on |
| `services` | no | on |
| `people` | yes | off |
| `attendance` | yes | off |
| `safeguarding` | yes | off |
| `wardrobe` | yes | off |
| `awards` | yes | off |
| `jc` | yes | off |

A switched-off module's routes answer **404, not 403**. A 403 says "there is
something here and you may not have it", which is a fact about the choir worth
not publishing — so dark means dark, and neither the front page, nor More, nor
the tab strip draws a door that is not there. Switching a module off deletes
nothing; the records stay and come back exactly as they were.

`/admin/more`, `/admin/guide` and the welcome dismissal belong to no module:
they are the app explaining itself, and each shows only what the reader may
already reach.

## Roles

Cloudflare Access decides who may reach `/admin` at all. That is not the same
question as who may see a child's telephone number — six people hold a Librarian
policy so the library can be catalogued by whoever is in the song school that
afternoon.

| Role | Reaches |
| --- | --- |
| **Librarian** | The catalogue, labels, scans, repairs, loans, reports, and the service music lists. No person data at all. |
| **Music staff** | Everything about people — the choir, the register, pay, awards, robes — and the app's own settings, modules, roles and exports. |
| **Safeguarding** | The duty rota, the on-the-day duty view, and one door inside `/admin/people`: a single child's parent contact, revealed deliberately and audited. |

Grants are managed at `/admin/roles`, audited, and the last `music_staff` grant
cannot be revoked — without one, nobody can grant anybody anything and the Roles
screen is itself music-staff-only. An authenticated admin holding no role gets a
page telling them who to ask.

Both checks are **one middleware over `/admin`**, not a check inside each
handler, so a route added next month is gated by existing. A path the role table
has never heard of needs `music_staff` — the narrowest grant there is — so
forgetting to add a rule is a visible mistake rather than a silent hole.

## Privacy rules

These apply everywhere, and `test/gate.test.ts` enforces several of them
mechanically rather than by good intentions.

- **No person data on the choir side**, with one exception: the names of
  whoever is on duty, on a service page. Names only — no telephone number, no
  DBS date, not even which of them is a backup — and nothing at all while the
  safeguarding module is off.
- **No person data in logs, analytics, feedback rows, error pages or URLs.**
  IDs only in paths. The audit log records that a child's record was edited and
  by whom, never the child's name or what the values were.
- **A school year, never an age and never a date of birth.** We are given one
  and not the other, so the app has no way to work out anybody's age and
  therefore no way to leak one.
- **Parent contacts are the hard gate.** Their own table, so every ordinary
  `SELECT` from `person` — every list, every picker, every export — is safe by
  construction. There is no GET that returns one: reading a number is a POST,
  because a bookmarkable URL showing a child's parent's telephone number is
  exactly what must not exist. The read writes its audit line *before* it
  fetches anything, so a look that cannot be recorded does not happen. One
  export in the app carries a number, and it is music staff only and separately
  audited with a fingerprint of the file.
- **Leavers** get a `left_on` date rather than a deletion: off every register
  and out of every picker, while their attendance stays exactly as it was,
  because that is what last quarter's pay was worked out from. Three ways out
  of a record exist and they are not the same thing — leaving (reversible),
  anonymising (the counts survive, the name does not), and deleting, which is a
  real delete and is what a parent asking for their child's record to be removed
  is entitled to.
- **Nothing about a real person is invented.** No people are seeded, ever. The
  department's workbook arrives through the importer at `/admin/people/import`,
  which reads it, shows it to a person, and writes nothing until they say so.
- **The nightly backup holds all of this**, which is why it goes to the
  Minster-side EU bucket with no public access, why nothing about its contents
  is logged beyond counts, and why there is no route in the app that reads one.

## Backups

Two layers. D1 Time Travel gives thirty days of point-in-time restore and needs
nothing set up. On top of that, a nightly cron dumps every table to R2 as JSONL
under `backups/YYYY-MM-DD/` with a manifest of row counts, and deletes anything
past thirty-five days. Restoring is documented, and deliberately manual, in
[docs/RESTORE.md](./docs/RESTORE.md).

## Data boundary

The Friends of Beverley Minster is a separate charity and a separate data
controller. This is a Minster app: it binds `minster-data` and `bmmusic-scans`
and nothing else, and no FoBM data reaches its D1, R2 or logs. The bindings are
fully disjoint from `fobm-vestry`'s.

## Licence

MIT — see [LICENSE](./LICENSE).
