# Getting the data back

Two layers, and they answer different questions.

| | D1 Time Travel | The nightly R2 dump |
|---|---|---|
| Covers | the last **30 days**, to any second in it | the last **35 days**, one snapshot a night |
| Restores | the whole database, in place | whatever you choose, by hand |
| Needs | nothing set up | the dump to have run |
| Good for | "somebody deleted the wrong thing an hour ago" | "the account is gone", "a migration went to the wrong database", "what did the register say in September?" |

**Reach for Time Travel first.** It is faster, it is exact to the second, and
it needs nothing but a terminal. The R2 dump exists for the failures Time
Travel cannot help with — and for the ones where you want the data without
wanting a restore.

Both are Minster-side. The bucket is `bmmusic-scans`, EU jurisdiction, no public
access. Nothing belonging to the Friends of Beverley Minster is in either.

---

## Before you restore anything

Stop and answer three questions, because a restore is itself a way to lose
data.

1. **What exactly is wrong, and when did it start?** A restore to the wrong
   moment loses everything done since. If the answer is "sometime this week",
   find out before you touch anything.
2. **What has happened since?** A register taken this morning, a pay run
   exported, a scan approved — all of it goes if you roll the whole database
   back to yesterday. The activity log (`/admin/activity`) is the fastest way
   to see.
3. **Is a full restore actually what you want?** Usually it is not. One table,
   or one row, put back from the JSONL dump is far less destructive than
   rewinding everything.

If you are not sure, take a bookmark first (below). It costs nothing and it
means the current state is recoverable even after you have overwritten it.

---

## 1. D1 Time Travel — the last 30 days

The database is `minster-data`.

### See where you can go back to

```sh
npx wrangler d1 time-travel info minster-data --remote
```

This prints the earliest timestamp available and the current bookmark.

### Take a bookmark of right now

**Do this before any restore.** A bookmark is a name for the current state, and
having one means the restore itself is reversible.

```sh
npx wrangler d1 time-travel info minster-data --remote
# note the bookmark it prints, and write it down somewhere that is not this terminal
```

### Look at a past state without committing to it

```sh
npx wrangler d1 export minster-data --remote \
  --output before.sql \
  --no-data=false
```

There is no "read-only time travel", so the honest way to inspect the past is
to restore into a scratch database rather than over the live one:

```sh
npx wrangler d1 create minster-data-scratch
# restore the export into it, then query it at leisure
npx wrangler d1 execute minster-data-scratch --remote --file before.sql
```

### Restore

By timestamp:

```sh
npx wrangler d1 time-travel restore minster-data --remote \
  --timestamp 2026-08-27T09:00:00Z
```

By bookmark:

```sh
npx wrangler d1 time-travel restore minster-data --remote \
  --bookmark 0000007b-00000002-00004ca7-...
```

**This replaces the whole database.** Everything written after that moment is
gone, including anything written between you deciding to restore and the
restore running. Tell anybody who might be using the app to stop first.

Afterwards, check the app: `/admin` (the counts), `/admin/activity` (the last
line should be from before the restore point), and `/admin/people` if the
register was involved.

---

## 2. The R2 dump — the last 35 days

Every night at 02:15 UTC the Worker writes one JSONL file per table to
`bmmusic-scans` under `backups/YYYY-MM-DD/`, plus `manifest.json` with the row
counts and the byte counts. Anything older than 35 days is deleted on the same
run.

The dump contains **children's names, their attendance, and their parents'
telephone numbers**. Treat a downloaded copy the way you would treat a printed
register: on a machine you control, deleted when you are finished with it,
never emailed.

### See what backups exist

```sh
npx wrangler r2 object get bmmusic-scans/backups/2026-08-27/manifest.json \
  --remote --pipe | jq .
```

The manifest names every table, its row count and its byte count. A table with
an `error` field failed that night; the rest of the run still happened.

### Fetch one table

```sh
npx wrangler r2 object get bmmusic-scans/backups/2026-08-27/person.jsonl \
  --remote --file person.jsonl
```

One JSON object per line, exactly as `SELECT *` returned it.

### Put rows back

There is deliberately **no route in the app that reads a backup**: an endpoint
that streams the whole database out is precisely what the rest of this
repository is arranged to prevent. Restoring is a person with a terminal.

Turn the JSONL into SQL and apply it. For a single table where you want the
backup's version to win:

```sh
# One INSERT per line, replacing any row with the same primary key.
jq -r '"INSERT OR REPLACE INTO person (" +
       ([keys_unsorted[]] | join(",")) + ") VALUES (" +
       ([.[] | if . == null then "NULL"
               elif type == "number" then tostring
               else "'\''" + (tostring | gsub("'\''"; "'\'''\''")) + "'\''" end]
        | join(",")) + ");"' person.jsonl > person.sql

npx wrangler d1 execute minster-data --remote --file person.sql
```

Check the SQL before you run it. `jq` will happily produce nonsense from an
unexpected value, and `--file` does not ask twice.

### Restore order

If you are putting several tables back, do it in the order
`BACKUP_TABLES` lists in `src/backup.ts` — parents before children, so foreign
keys resolve as the rows land and nothing has to be switched off.

---

## Restoring a single person's record

The commonest real case, and it needs neither of the above in full.

1. Find them in the day's `person.jsonl` by name.
2. Their attendance is in `attendance.jsonl`, matched on `person_id`.
3. Their parents' contacts are in `parent_contact.jsonl`, same key.
4. Put back only what is missing, with `INSERT OR IGNORE` rather than
   `INSERT OR REPLACE`, so nothing recorded since is overwritten.

---

## If the backup has not been running

Check the activity log for `backup.run` lines, or list the bucket:

```sh
npx wrangler r2 object list bmmusic-scans --prefix backups/ --remote
```

No lines and no objects means the cron is not firing or the bucket is not
bound. Both show up in the Worker's logs at 02:15 UTC. The bucket binding is
`SCANS` in `wrangler.toml`; without it the job logs "nightly backup skipped: no
R2 bucket bound" and does nothing else.

---

## What is not backed up here

- **The R2 objects themselves** — the scans, the booklets, the working copies.
  They are in the same bucket and are not copied to a second one. Losing the
  bucket loses both them and the dumps.
- **Secrets.** `SESSION_SECRET`, `CHOIR_PASSWORD`, `ANTHROPIC_API_KEY` live in
  the Cloudflare dashboard and are not in any dump, deliberately. Rotating
  `SESSION_SECRET` after a restore signs everybody out, which after an incident
  is usually the right thing anyway.
- **Cloudflare Access policies.** Who may reach `/admin` at all is configured in
  Access, not here. The in-app roles (`admin_role`) *are* in the dump.
