# How music gets into the catalogue

Three ways in, in the order they matter:

1. **The draft index** — the committed CSV, imported in bulk. This is how the
   catalogue got its first 324 rows.
2. **Photo intake** — photograph a label, have it read, check it, add it. This
   is how the rest of the library gets in, and how mistakes in the draft index
   get corrected against the actual parcel.
3. **By hand** — the same intake form with nothing filled in. Always available,
   and the fallback whenever reading a label is switched off or fails.

Everything here rests on one rule: **nothing is presented to the choir as
settled fact until a human has confirmed it.** Both automated routes produce
*draft* rows carrying their own uncertainty, and both end at the review queue.

---

## 1. The draft index

`data/seed/bm-music-draft-index.csv`, imported from `/admin/import`. The
column-by-column description is in `data/seed/README.md`; this section covers
the two judgement calls the importer makes.

### Category mapping

The CSV's `category` column holds the words whoever read the labels wrote down.
The catalogue's `category` column holds one of eight codes. Three map straight
across; the rest need the title, and where the title does not settle it the row
is mapped to the likeliest code **and flagged**, so the guess is visible in the
review queue rather than buried in the data.

| Draft category | Rows | Becomes | How |
| --- | --- | --- | --- |
| `anthem` | 245 | `A` Anthem | Direct. Not flagged. |
| `carol` | 3 | `X` Carol | Direct. Not flagged. |
| `responses` | 7 | `R` Responses | Direct. Not flagged. |
| `canticle` | 3 | `M` or `E` | `M` if the title names a morning canticle (Te Deum, Benedictus, Jubilate, Venite, Benedicite), `E` if it names Mag or Nunc. Flagged either way. |
| `setting` | 58 | `C` or `E` | `C` if the title names a Mass, Missa, Eucharist, Communion or an ordinary movement; otherwise `E`. Flagged. |
| `major work`, `collection`, `hymn` | 8 | `S` Solo and other | No code fits a Fauré Requiem or a box of hymn descants. Flagged so a human can decide. |
| anything else, or blank | — | `S` Solo and other | Flagged. |

The `setting` → `E` assumption is the biggest guess the importer makes. Nearly
every setting in the boxes is a Magnificat and Nunc dimittis — they are filed by
key alone (`in E flat`, `in B minor`), which is an Evensong habit — but "nearly
every" is not "every", so all 58 arrive flagged with
`draft category 'setting' — assumed evening canticles`.

### What raises a review flag

Flags are `; `-joined in `piece.review_flag` and shown as separate pills. A row
gets one for each of:

| Reason | Flag |
| --- | --- |
| `confidence` below 0.80 | `draft confidence 0.55` |
| Each entry in the CSV's `flags` column | `label note: damaged` |
| A category that was inferred rather than stated | the reason from the table above |
| No title read | `no title read from the label` |
| No composer read | `no composer read from the label` |
| A `?` anywhere in the composer | `composer uncertain on the label` |

Confirming a piece in the review queue clears its flags: they are reasons to
look, and somebody has now looked.

### Re-running it

The importer is idempotent, keyed on `legacy_ref` (the CSV's `ref`):

- **New ref** → inserted.
- **Known ref, not yet reviewed** → refreshed from the file, and its
  `seed-title` aliases are replaced so a corrected title does not leave the old
  spelling behind as a match.
- **Known ref, already confirmed by a human** → left completely alone.
- **The same ref twice in one file** → rejected, with the reason shown on the
  import screen. Two rows claiming `D-042` means the file is wrong, and picking
  one silently would hide that.

Keep `ref` values stable between cuts. That is the thread tying a corrected row
back to the piece it corrects.

---

## 2. Photo intake

`/admin/intake`, following the estate's upload → extract → review → confirm
pattern (the same shape as vestry's scanned-document intake).

1. **Upload.** A photo of one parcel label, taken on a phone. JPG, PNG, WebP or
   a PDF.
2. **Extract.** `POST /admin/api/read-label` sends the image to the Anthropic
   Messages API (`claude-sonnet-5`) with the prompt below and a strict JSON
   schema. Every field comes back with a confidence and the verbatim text it was
   read from. The image is processed in flight and never stored.
3. **Review.** The form fills in, showing under each field what was read and how
   sure the reading was. Anything below 0.80 is shown in red, and is added to
   the row's review flags automatically — so a shaky reading cannot be confirmed
   into the catalogue just by pressing the button.
4. **Confirm.** Nothing is written until the button is pressed. A parcel holding
   several pieces keeps the joined title and gains one alias per piece, the same
   rule the seed importer follows.

### Degrading gracefully

With `ANTHROPIC_API_KEY` unset the upload step is not offered at all. The screen
says so plainly and shows the manual form instead. A volunteer standing in a
cold song school holding a parcel should never meet an error page, and a missing
key is a configuration fact, not a fault.

The same applies when the call fails: a network error, a rate limit or an
unreadable photo all land on "please enter the details by hand", with the form
already in front of them. The API's own error text is never shown — it goes to
the Worker's logs.

### The label-reading prompt

Kept in step with `LABEL_PROMPT` in `src/extract.ts`, which is what actually
runs. The category list is generated from `church.config` so the two cannot
drift.

> You are reading a photograph of a label on a parcel or box of choral music in
> the song school at Beverley Minster. Somebody will check everything you
> return, so your job is to read accurately and to be honest about what you
> cannot read — not to produce a tidy answer.
>
> Return what the label says, and only what the label says.
>
> Rules:
>
> 1. Read, do not interpret. If the label says "BAIRSTOW", the composer is
>    "BAIRSTOW", not "Sir Edward Bairstow". If a word is half-legible, give your
>    best reading and lower the confidence.
> 2. Never complete a field from your own knowledge of the repertoire. If the
>    label gives a title but no composer, the composer is null — even when you
>    are certain who wrote it. Somebody who knows this library will fill it in.
> 3. Set every confidence honestly, 0 to 1. Handwritten, faded, or ambiguous
>    readings should be well below 1. A confidence above 0.9 means you could
>    read it as plainly as print.
> 4. Put the characters you actually see in "verbatim", before any tidying: keep
>    the label's capitalisation, its abbreviations ("Mag & Nunc"), and its
>    question marks.
> 5. A parcel often holds several pieces. List every title separately, in the
>    order written. Do not merge them and do not invent a collective title.
> 6. Category must be one of these codes, or null when the label does not settle
>    it: *(the eight codes and their blurbs, from `church.config`)*. Choose null
>    rather than guessing between two. A setting filed by key alone ("in E
>    flat") is usually evening canticles (E), but say so in "concerns" if that is
>    the only reason.
> 7. Voicing is what is written (SATB, SS, ATB, unison, "Trebles"). Do not
>    deduce it from the composer or the piece.
> 8. Season is only what is written (Advent, Lent, Easter, Christmas,
>    Passiontide).
> 9. Location is any shelf, box or parcel marking — "Box 4", "pencil 44 on box",
>    a cupboard name.
> 10. If the label gives a number of copies, put it in copiesTotal. A pencilled
>     number that might be a copy count or might be a box number goes in
>     otherText, with a note in "concerns" — do not guess which it is.
> 11. Put anything else written on the label into otherText verbatim: old
>     references, "see also" notes, publisher names, donors' names.
> 12. Use "concerns" for anything a human should look at: an unreadable word,
>     two possible readings, a damaged label, a cross-reference to another
>     parcel, the reason a category was a guess.
>
> If the photograph shows no readable label at all, return nulls with confidence
> 0 and say so in "concerns". Do not describe the photograph.

Rules 2 and 10 are the ones earning their keep. A model that knows the
repertoire will happily supply "Byrd" for an unattributed *Ave verum corpus*,
and it will be right often enough to be dangerous — the catalogue would fill
with confident attributions nobody ever checked against the parcel. And the
pencilled numbers on these boxes are genuinely ambiguous: `pencil 44 on box`
appears in the draft index precisely because the cataloguer could not tell a
copy count from a box number either.

---

## 3. Counting (the volunteer portal)

Not an intake route — the piece already exists — but it writes to the catalogue,
so it belongs here.

A volunteer at `/portal` finds a parcel by accession number, composer or title,
opens it, and records: copies total, copies usable, condition, the voicing
printed on the copies, and a note. That writes a `holding` row. Counts are
**never** overwritten: each one is a new row, and "how many are there" means
"what did the last person to open the parcel find".

Three things follow from a count:

- **A disagreement flags the piece.** A total different from the last count, any
  unusable copies, a `poor`/`urgent` condition, or a voicing that contradicts
  what is catalogued — each adds a review flag rather than silently replacing
  what was there.
- **`poor` or `urgent` opens a repair job**, unless one is already open.
- **A voicing fills in an empty field** but never overwrites one somebody has
  already set.

The confirmation screen asks for one copy to be set aside for scanning. That is
the whole point of getting the parcels open: the scanning backlog is Phase 1,
and it is far cheaper to pull a copy while the parcel is already open than to
find it again later.

---

## What is not here

**Music-list data.** `bmserviceapp`'s daily cron is the estate's single parser
of the Minster's monthly music list, and this app must never fetch or parse that
document (`docs/ESTATE.md`, "Single ingestion path"). When the pinch-point
warnings land in Phase 2 they will read
`GET /api/music?month=YYYY-MM` from `bmserviceapp`, server-side, match entries
against `piece` and `alias`, and divide the choir size from `choir_profile` into
`copies_usable`. Matching is why `alias` exists.
