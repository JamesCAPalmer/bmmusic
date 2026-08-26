# Seed data

## `bm-music-draft-index.csv`

A **draft** index of the physical music library, read off photographs of the
parcel and box labels in the song school. 324 rows.

| Column | What it holds |
| --- | --- |
| `ref` | Draft reference, `D-001` upwards. Becomes the piece's `legacy_ref`, and is the key the importer matches on when it is re-run. |
| `composer` | Composer as printed on the label. A trailing `?` is the cataloguer's doubt. |
| `titles` | Title as printed. Multi-title parcels are `;`-joined (65 rows). |
| `category` | Loose draft category: `anthem`, `setting`, `responses`, `canticle`, `carol`, `collection`, `major work`, `hymn`. Mapped onto the catalogue's codes by `src/seed.ts` — see `docs/PIPELINE.md`. |
| `handwritten` | `yes` / `no` / `mixed`. Goes into the piece's notes. |
| `confidence` | 0–1, how confident the reading is. Below 0.80 raises a review flag. |
| `source_photos` | The label photograph this row came from, e.g. `IMG_4272`. |
| `flags` | Free-text notes from the cataloguer (`check`, `damaged`, `two parcels`). Each becomes a review flag verbatim. |

**This file is a draft, not a catalogue.** Every row it imports lands
unreviewed, and is confirmed by a human in the admin review queue at
`/admin/review` before it counts as settled.

## Replacing it

Replace this file with a better cut and re-run the import from
`/admin/import`. The importer is idempotent: it is keyed on `ref`, refreshes
rows nobody has reviewed yet, and leaves reviewed rows completely alone. Keep
the `ref` values stable between cuts — that is what ties a corrected row back to
the piece it corrects. A `ref` that appears twice in one file is rejected, with
the reason shown on the import screen, rather than silently merged.
