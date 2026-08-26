# bmmusic — the Minster music library

A private catalogue of the physical music library at Beverley Minster: the
anthems in wrapped parcels and the service settings in boxes in the song school,
roughly 500–600 items. It records what we have, how many copies, and what state
they are in — and gives the choir a way to look a piece up without opening a
cupboard.

Part of the [Beverley Minster app estate](https://github.com/JamesCAPalmer/bmserviceapp/blob/main/docs/ESTATE.md).
A single Cloudflare Worker (Hono, server-rendered, no client framework) at
`bmmusic.james-palmer.com`, with D1 for the catalogue and R2 for scans.

**There are no public pages.** The choir side is behind a shared password,
`/admin` is behind Cloudflare Access, every response carries noindex headers,
and `robots.txt` disallows everything.

## What is here

| | |
| --- | --- |
| **Choir** | Browse and search by composer, title, category and voicing; an item page with copy counts and where the parcel lives. |
| **Volunteers** | A phone-shaped portal for counting a parcel: totals, condition, voicing, notes. |
| **Librarian** (`/admin`) | The review queue for draft entries, accession numbering, an item editor, photo intake, and the draft-index importer. |

Phase 0 does not include PDF viewing, performance history, YouTube mining,
booklet building, or the pinch-point warnings. The item page marks where those
will go.

## Layout

```
src/church.config.ts   every Minster-specific fact (estate pattern — pure data)
src/theme.ts           design tokens, separate from layout (estate pattern)
src/ui.ts              the pages
src/index.ts           routes
src/auth.ts            the choir password gate and the Access gate
src/catalogue.ts       all the D1
src/seed.ts            the draft-index importer
src/extract.ts         label reading (Anthropic), and its fallback
migrations/            the D1 schema
data/seed/             the committed draft index
docs/PIPELINE.md       how music gets in, and the label-reading prompt
```

A fork of this app for another church edits `church.config.ts` and `theme.ts`
and nothing else. If a third file needs touching, a fact has leaked out of
config and should go back.

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

`ADMIN_MODE="local"` opens `/admin` without Cloudflare Access. **It must never
be set in production** — the deployed `wrangler.toml` sets `"access"`.

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

---

# Deploying — a runbook

Roughly twenty minutes end to end, most of it waiting for DNS.

## 1. Sign in to Cloudflare

```sh
npx wrangler login
npx wrangler whoami          # check it is the right account
```

## 2. Create the R2 bucket

The bucket is created in the **EU jurisdiction**:

```sh
npx wrangler r2 bucket create bmmusic-scans --jurisdiction eu
```

A jurisdiction *guarantees* the objects are stored and processed inside the EU.
That is a stronger thing than a location hint (`--location weur`), which is only
a best-effort placement for performance and carries no residency promise — so
pass `--jurisdiction eu` and not the hint.

**A jurisdiction is a separate namespace, and this catches people out.** The
binding in `wrangler.toml` carries `jurisdiction = "eu"`, and it has to: without
it the binding looks for `bmmusic-scans` in the *default* jurisdiction, does not
find the EU bucket, and provisioning quietly creates a second empty bucket of
the same name in the default region. If that has already happened you will have
two buckets called `bmmusic-scans`. List them separately to tell them apart:

```sh
npx wrangler r2 bucket list                  # the default jurisdiction
npx wrangler r2 bucket list --jurisdiction eu
```

Delete the stray default-jurisdiction one once you have checked it is empty —
`npx wrangler r2 bucket delete bmmusic-scans` with **no** `-J` flag targets the
default one. Every other `wrangler r2 ...` command against the real bucket needs
`-J eu`.

A bucket's jurisdiction cannot be changed after it is created, so if the EU
bucket does not exist yet, create it now with the command above rather than
trying to move an existing one.

The D1 database `minster-data` already exists and is currently empty. Nothing to
create.

## 3. Deploy once

```sh
npx wrangler deploy
```

This creates the Worker so there is something to attach bindings and a domain
to. It will not work properly yet — the bindings come next.

## 4. Bindings, in the dashboard

Estate rule: bindings live in the Cloudflare dashboard, never in the repository.
`wrangler.toml` carries names only, with no database id and no account id.

**Workers & Pages → bmmusic → Settings → Bindings:**

| Type | Variable name | Points at |
| --- | --- | --- |
| D1 database | `DB` | `minster-data` |
| R2 bucket | `SCANS` | `bmmusic-scans` |

**Settings → Variables and Secrets**, as **Secret** (not plaintext):

| Secret | What it is |
| --- | --- |
| `CHOIR_PASSWORD` | The shared choir password for this term. |
| `SESSION_SECRET` | A long random string. `openssl rand -hex 32`. |
| `ANTHROPIC_API_KEY` | Optional. Turns on label reading in photo intake; without it the screen takes manual entry. |

`ADMIN_MODE` is already set to `access` as a plaintext variable by
`wrangler.toml`. Leave it alone.

Deploy again after adding bindings, so the Worker picks them up:

```sh
npx wrangler deploy
```

## 5. Apply the migrations

```sh
npx wrangler d1 migrations apply minster-data --remote
```

`--remote` matters — without it you migrate the local copy and the deployed app
sees an empty database.

## 6. Cloudflare Access on /admin

**Zero Trust → Access → Applications → Add an application → Self-hosted:**

- Application name: `bmmusic admin`
- Session duration: 24 hours
- Public hostname: `bmmusic.james-palmer.com`, path `admin`
- Policy: Allow, `Emails` → your address.

The path matters. Covering the whole hostname would put Access in front of the
choir side too, and the choir does not have Cloudflare accounts.

Once this is live the Worker sees `Cf-Access-Jwt-Assertion` on admin requests.
Without that header `/admin` returns 403, so if Access is misconfigured the
admin side fails closed rather than open.

## 7. Custom domain

**Workers & Pages → bmmusic → Settings → Domains & Routes → Add → Custom
domain**, and enter `bmmusic.james-palmer.com`. Cloudflare adds the DNS record
and issues the certificate; give it a few minutes.

`workers_dev = false` in `wrangler.toml` means there is no
`bmmusic.workers.dev` back door. The custom domain is the only way in.

## 8. Load the catalogue

Visit `https://bmmusic.james-palmer.com/admin/import` and press **Import now**.
That reads the committed draft index — 324 rows — into the catalogue, and seeds
the choir designations from `church.config`.

Safe to run again whenever you replace the CSV: it is keyed on the draft ref,
refreshes rows nobody has reviewed, and leaves confirmed rows alone. See
`docs/PIPELINE.md`.

## 9. Check it

- `https://bmmusic.james-palmer.com/` → the password screen.
- Sign in → the catalogue, with 324 pieces.
- `/admin` → Cloudflare Access, then the librarian's page.
- `/robots.txt` → `Disallow: /`.
- Sign out, then open `/piece/1` directly → back to the password screen.

---

## Rotating the choir password

**Once a term.** People leave the choir, and a shared password is only a gate
while the people who have left do not have it.

1. Change `CHOIR_PASSWORD` in the dashboard to this term's password.
2. Change `SESSION_SECRET` at the same time — `openssl rand -hex 32`.
3. Tell the choir the new password.

Step 2 is the one that does the work. Changing the password alone leaves
everybody already signed in still signed in, with sessions lasting 90 days;
changing the session secret invalidates every existing cookie at once, so
everybody signs in again with the new password. Changing both is a single edit
in the dashboard and needs no deploy.

## Data boundary

The Friends of Beverley Minster is a separate charity and a separate data
controller. This is a Minster app: it binds `minster-data` and `bmmusic-scans`
and nothing else, and no FoBM data reaches its D1, R2 or logs. The bindings are
fully disjoint from `fobm-vestry`'s.

## Licence

MIT — see [LICENSE](./LICENSE).
