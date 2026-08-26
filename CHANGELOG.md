# Changelog

A reverse-chronological history of substantive changes to bmmusic,
grouped by working session, in the style of the estate's hub repo. Each
entry says what changed and why, so future-you can navigate back to the
diff.

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
