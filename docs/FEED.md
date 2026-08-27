# The music feed, and how bmmusic reads it

## The estate rule this sits under

bmserviceapp's daily cron is the **only** parser of the Minster's monthly music
list in the whole estate. bmmusic never fetches or parses that document. What it
does is read bmserviceapp's *output* — a JSON feed — and nothing else.

If you are ever tempted to add a `.docx` or `.pdf` reader to this repository,
that is the rule you are about to break, and the answer is to change
`docs/ESTATE.md` in the hub repo first, deliberately, or not do it.

## The contract, as observed

Recorded here because it was read off the live feed rather than a specification,
so it is worth writing down what was actually seen. `GET /api/music?month=YYYY-MM`
against `CHURCH.estateApi.baseUrl`:

```json
{
  "month": "2026-08",
  "parsedAt": "2026-07-31T21:56:42.969Z",
  "sourceHash": "cef0e469a34ba24a",
  "sourceUrl": "https://beverleyminster.org.uk/wp-content/uploads/August-Music-2026-Copy.docx",
  "parsedBy": "llm",
  "services": [
    {
      "date": "2026-08-01",
      "time": "17:00",
      "name": "Choral Evensong",
      "choir": "Symbel choir",
      "responses": "Esther Bersweden",
      "psalm": "6",
      "canticles": "King's College Service (Joanna Forbes L'Estrange)",
      "introit": "Tune me, O Lord (Lucy Walker)",
      "anthem": "Seek Him that maketh the seven stars (Jonathan Dove)",
      "voluntary": "Offertoire in G minor (Louis Lefebure-Wely)",
      "notes": "Coventry Gloria (Peter Jones), Sanctus and Agnus Dei",
      "hymns": ["285"]
    }
  ]
}
```

A month with nothing published yet answers `200` with
`{"month": "…", "services": [], "note": "no data"}` — an empty month, not an
error, and the ingest treats it as one.

Every field but `date` is optional. `choir` is sometimes `null` and sometimes
absent. **There is no id on a service**, which is why `feedRefFor()` derives one
from date, time and name; that derivation is the upsert key, so changing its
shape would duplicate every service already stored rather than updating it.

## The feed is untrusted input

`parsedBy: "llm"` is the important field. The feed is produced by a language
model reading a Word document off a website, and it is occasionally wrong in
ways obvious to a person and invisible to a parser. Real examples currently
live in it:

- `"Ave verum corpus (Wiliam Byrd)"` — William, misspelled.
- `"Tomas luis da Vittoria"` — Victoria, twice over.
- `"Herbert Sumson in G"` — Sumsion, missing an `i`.
- `"RCSM"` as a choir — the RSCM, transposed.

So `readFeedMonth()` type-checks every field before use, skips a service it
cannot read rather than failing the whole month, and writes nothing a human
cannot correct.

## The hash gate

bmserviceapp publishes `sourceHash` — its own hash of the document it parsed. We
keep the last one seen per month in `app_setting` under `feed_hash:YYYY-MM`, and
an unchanged month returns without touching the database at all. That is what
makes an hourly cron reasonable for a document that changes monthly.

## What survives a re-fetch

The music list is re-parsed whenever the source document is touched, including
when somebody fixes a typo in the Word file. James confirming forty lines must
not be undone by that. So:

- Lines are compared on **slot and raw text**, not position — the parser
  reordering fields must not look like every line having changed.
- A line whose text is unchanged keeps its piece and its match state, including
  `confirmed`.
- A line whose text *has* changed is a different line, and is matched afresh.
- A line the list no longer carries is removed. The music list is the truth
  about what is being sung.

## What the matcher achieves

Measured by running `src/matcher.ts` over four real months of the feed
(May–August 2026) against the committed draft index — 124 matchable lines:

| | |
| --- | --- |
| Matched automatically | **48%** |
| Left for one tap in the queue | 52% |

That number is deliberately not higher. An earlier scoring rule reached 61% and
included real false positives: "O for a closer walk with God (Stanford)" landed
on a different Stanford parcel that shared one word, and "Lord, I trust thee
(Handel)" on a different Handel one. The library holds fifteen Stanford parcels;
an unmatched line costs a tap, and a wrongly matched one sends a chorister to
the wrong parcel with nobody the wiser until the rehearsal. Both cases are now
regression tests in `test/matcher.test.ts`.

The rate climbs on its own regardless, because **every confirmation is
remembered**. Confirming a line writes the normalised raw text and the piece
into `match_alias`, and that phrasing matches outright from then on.

## Known limitations, in rough order of how often they bite

1. **Movement prefixes.** `"Sanctus and Agnus Dei – Francis Jackson in G"` and
   `"Gloria Missa Brevis (Lennox Berkeley)"` are read as one long title. They
   land in the queue and are learned after one tap.
2. **A misspelled composer never matches.** Composer comparison is on whole
   words, so `"Sumson"` does not reach `"Sumsion"`. Fuzzier matching here would
   cost more in false positives than it gains.
3. **Psalms, hymns and voluntaries are never matched** — a psalm is a number and
   a pointing, a hymn is a number in the hymn book, and a voluntary is organ
   repertoire that does not live in the song school. They are recorded and shown
   but never proposed, which keeps three lines of noise a week out of the queue.
