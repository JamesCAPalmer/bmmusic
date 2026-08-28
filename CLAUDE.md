# CLAUDE.md — project context

## Part of the Beverley Minster app estate

This repository is maintained alongside the Beverley Minster apps. **Before
making any structural change, read `docs/ESTATE.md` in
[JamesCAPalmer/bmserviceapp](https://github.com/JamesCAPalmer/bmserviceapp/blob/main/docs/ESTATE.md).**
It is the shared specification: the `church.config` pattern, the theme layer,
the single ingestion path for Minster music-list data, the API contract and the
data boundary below. If a change here would contradict it, change that document
first — deliberately — or don't make the change.

In this repository the estate patterns are:

- `src/church.config.ts` — every institution-specific fact (names, domains,
  choir profiles, service patterns, the estate music API base URL). Code reads
  config; config never imports code. Secrets stay in `env`, never in the file.
- `src/theme.ts` — the design tokens, separate from the layout styles in
  `src/ui.ts`. The shape is copied from `fobm-vestry`, the estate's UI template.

A fork of this app for another church should need to edit those two files and
nothing else.

## Data boundary — non-negotiable

**The Friends of Beverley Minster is a separate charity and a separate data
controller from Beverley Minster.** This is a Minster app. Therefore:

- It must never bind or read anything belonging to `fobm-vestry` / the Friends —
  no shared KV namespace, D1 database, R2 bucket, queue or secret. The bindings
  in `wrangler.toml` (`DB` → `minster-data`, `SCANS` → `bmmusic-scans`) are
  fully disjoint from the Friends' Worker.
- No FoBM personal data enters this app's D1, R2, logs or analytics.

## Single ingestion path

`bmserviceapp`'s daily cron is the estate's **only** parser of the Minster's
monthly music list. This app must never fetch or parse that document. When the
pinch-point warnings land (Phase 2), they read
`GET /api/music?month=YYYY-MM` from `bmserviceapp` server-side, per
`docs/API.md` in the hub repo.

## What this is

**bmmusic** — a private, choir-facing catalogue of the Minster's *physical*
music library: roughly 500–600 items in boxes in the song school, behind a run
of eight cupboards. Plus an admin side for cataloguing. Hosted as a single
Cloudflare Worker at `bmmusic.james-palmer.com`.

**Say "box".** The anthems are physically in wrapped parcels and the service
settings are in boxes, and the app used to say both. It now says *box*
throughout, for everything — one word for one idea, because a volunteer holding
the thing does not care which it technically is and should not have to guess
which word the screen will use. Nothing in the database changed: this was
always prose.

**The cupboards have names, and the names are diesel locomotive classes** —
Deltic, Western, Warship and so on, one per door, Robert's idea. The letter
`A`–`H` is what is stored, printed on labels and painted on the doors; the name
is display only, so removing or renaming one is an edit to
`CHURCH.storage.doors` and nothing else. See `src/storage.ts`.

Users are the Minster choir (shared password, rotated each term), a handful of
volunteers doing the physical count on their phones, and James (admin, behind
Cloudflare Access).

## Non-negotiable domain rules

- **No public URLs.** Every route is gated; every response carries noindex
  headers; `/robots.txt` disallows everything. R2 objects are streamed through
  an authenticated route — the bucket has no public access and no signed
  public object URLs.
- **The draft index is a draft.** `data/seed/bm-music-draft-index.csv` was read
  off photographs of box labels; its `confidence` and `flags` columns mean
  what they say. Seed rows land as unreviewed pieces carrying a `review_flag`
  and are confirmed by a human in the admin review queue. Nothing in the seed
  is presented to the choir as settled fact without that.
- **Accession numbers are assigned, never guessed.** `accession` is null until
  an admin assigns it. Assignment is sequential in catalogue order
  (`composer_canonical`, then `title`) and never renumbers an existing one.
- **The importer is idempotent.** James will replace the CSV with a better cut
  and re-run it. Re-running must not duplicate pieces or aliases, and must not
  overwrite a piece a human has already reviewed.
- **Extraction never guesses.** The photo-intake extraction (Anthropic API,
  strict JSON schema, per-field confidence) feeds an editable review form.
  With `ANTHROPIC_API_KEY` unset the screen degrades to manual entry rather
  than failing — see `docs/PIPELINE.md`.

## Schema

D1 database `minster-data` (shared Minster database; this app owns the tables
in `migrations/`). `piece` is the spine; `alias` carries alternative titles for
matching music lists and YouTube mining; `holding` carries copy counts and
condition; `file` points at R2 scans; `performance` records where a piece has
been sung; `choir_profile` mirrors the estate's choir designations;
`repair_job` tracks the repair queue.

## Style

- UI: plain British English, large type, one obvious action per page, no jargon,
  actionable error messages (never stack traces).
- Code: TypeScript strict, Hono, server-rendered pages, no client framework and
  no CDN assets. Vitest tests for the pure modules (schema shape, CSV import,
  auth, accession ordering).
- No dependencies beyond Hono and wrangler.
