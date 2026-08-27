# Deploying

Roughly twenty minutes end to end for a first deploy, most of it waiting for
DNS. If the app is already deployed and you are just shipping a change, you
want [Shipping a change](#shipping-a-change) at the bottom.

---

## Migrations are not automatic

**Read this before anything else, because it is the one that bites.**

Cloudflare Workers Builds deploys the code on every merge to `main`. **Nothing
applies the database migrations.** That is a manual step, every time a
migration is added.

If the schema is behind the code, the app does not degrade — it **500s on every
gated page**, because `authMiddleware` reads `app_setting` before it does
anything else. `/login` and `/robots.txt` keep working, which makes it look
like a page-specific fault rather than a schema one.

So: after any deploy that includes a new file in `migrations/`, run step 5 and
then step 5a. It takes ten seconds and it is the difference between a working
app and a white error page for the whole choir.

---

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
bucket does not exist yet, create it now rather than trying to move an existing
one.

The D1 database `minster-data` already exists and holds the catalogue. Nothing
to create.

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
| `CHOIR_PASSWORD` | The shared choir password. Only used until one is set from `/admin/settings`; after that it is never consulted again. |
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
sees a database that is missing everything.

### 5a. Check it actually applied

Do not skip this. It is one command and it is how you find out *now* rather
than from a choir member's screenshot.

```sh
npx wrangler d1 execute minster-data --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

You should see `app_setting`, `service`, `person`, `duty`, `rate`,
`parent_contact`, `import_batch` and the rest. If you only see `piece`,
`alias`, `holding`, `file`, `performance`, `choir_profile` and `repair_job`,
only migration 0001 has run and the app will 500 on every gated page.

### What the migrations do that is worth knowing

**`0002`** is additive only — 0001 had already run against `minster-data`, and
what is in it is the product of somebody's afternoons in a cold song school.

**`0003`** rebuilds the `person` table, because SQLite cannot alter the CHECK
constraint on `choir` and the junior choir needed a fifth value. **It carries
the register across by hand**, out to a scratch table and back, because dropping
`person` fires an implicit `DELETE FROM` and `attendance` cascades from it — and
neither `PRAGMA foreign_keys=OFF` nor `PRAGMA legacy_alter_table=ON` prevents
that inside the transaction wrangler applies a migration in. Both were measured;
both lost every attendance row. It is safe as written, and
`test/migrations.test.ts` refuses any future migration that drops a table
without putting the dependent rows back.

`0003` also grants `james@everinghampark.co.uk` all three in-app roles. Without
a first `music_staff` nobody can grant anybody anything, and the Roles screen is
itself music-staff-only.

**`0004`** adds the workbook importer's pending tables. Nothing else touches
them.

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

**A second, tighter application** can be added later over the two paths that
carry children's data — `admin/people` and `admin/safeguarding` — without any
code changing. Every route rendering a person's name is under one of those two
prefixes on purpose, and a test enforces it.

## 7. Custom domain

**Workers & Pages → bmmusic → Settings → Domains & Routes → Add → Custom
domain**, and enter `bmmusic.james-palmer.com`. Cloudflare adds the DNS record
and issues the certificate; give it a few minutes.

`workers_dev = false` in `wrangler.toml` means there is no
`bmmusic.workers.dev` back door. The custom domain is the only way in.

## 8. Load the catalogue

Visit `https://bmmusic.james-palmer.com/admin/import` and press **Import now**.
That reads the committed draft index — currently 410 rows — into the catalogue,
and seeds the choir designations from `church.config`.

Safe to run again whenever you replace the CSV: it is keyed on the draft ref,
refreshes rows nobody has reviewed, and leaves confirmed rows alone. See
[PIPELINE.md](./PIPELINE.md).

## 9. Check it

- `https://bmmusic.james-palmer.com/` → the password screen.
- Sign in → the catalogue, with the full piece count.
- `/admin` → Cloudflare Access, then the librarian's page.
- `/admin/modules` → eight modules, six of them off.
- `/robots.txt` → `Disallow: /`.
- Sign out, then open `/piece/1` directly → back to the password screen.

---

## Shipping a change

Merging to `main` triggers a Workers Build, which deploys the code by itself.
What it does **not** do:

1. **Apply migrations.** If `migrations/` gained a file, run step 5 and 5a.
2. **Register new cron schedules.** These come from `wrangler.toml` at deploy
   time. A Workers Build deploy picks them up; if you are unsure, check
   **Workers & Pages → bmmusic → Settings → Trigger Events**. There should be
   three: `30 * * * *` (the feed), `15 2 * * *` (the backup) and `0 3 1 9 *`
   (the September school-year rollover).

---

## Rotating the choir password

**Once a term.** People leave the choir, and a shared password is only a gate
while the people who have left do not have it.

**Do it from `/admin/settings`.** Type the new password twice and press the
button. That stores a salted PBKDF2 hash and bumps a `password_generation`
counter that is mixed into the session cookie's signing key — so every cookie
already issued stops verifying immediately, and the chorister who left at
Christmas is out. You will be signed out of the choir side yourself, which is
the same thing happening to you.

The `CHOIR_PASSWORD` secret in the dashboard is only consulted until a password
has been set here, and never again afterwards. There is no need to touch it,
and no need to redeploy.

**The dashboard route still exists as a fallback** if the admin side is
unreachable: change both `CHOIR_PASSWORD` and `SESSION_SECRET`
(`openssl rand -hex 32`). Changing the password alone leaves everybody already
signed in still signed in for up to ninety days; changing the session secret is
what invalidates the existing cookies.

## Restoring data

See [RESTORE.md](./RESTORE.md) — D1 Time Travel for the last thirty days, the
nightly R2 dump for thirty-five, and which to reach for.
