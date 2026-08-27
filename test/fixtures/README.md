# Test fixtures

## `workbook.xlsx`

A real `.xlsx` — a genuine ZIP of XML, not a mock — built to contain every
awkward thing a workbook written by Excel or Numbers actually does, so that
`src/xlsx.ts` is tested against the format rather than against an idea of it:

- **mixed compression** — `[Content_Types].xml` and one worksheet stored
  uncompressed, everything else deflated, because real writers vary;
- **a shared string table**, which is where Excel puts nearly all text;
- **a rich-text cell** split across two `<t>` runs (`"Beth " + "Clarke"`) — a
  reader that takes the first run gets `"Beth "`;
- **an escaped entity** (`Anna O&apos;Brien`), because apostrophes in surnames
  are not rare;
- **an inline string**, which Numbers writes where Excel would use the table;
- **a date serial** (`45900` = 31 August 2025);
- **a gap in the middle of a row** — row 3 has no cell at all in column C, and
  a reader that appends as it goes puts the telephone number in the wrong
  column for exactly the rows where something was left blank;
- **a self-closing empty row** (`<row r="4"/>`), so row numbering survives.

### Rebuilding it

It is small and readable, and it is committed so the tests do not depend on
having Python to hand. To change it, edit and run:

```sh
python3 - <<'PY'
import zipfile
# ... see the git history of this file's first commit for the full script,
# or write the XML parts you need and zip them with the paths below:
#   [Content_Types].xml
#   _rels/.rels
#   xl/workbook.xml
#   xl/_rels/workbook.xml.rels
#   xl/sharedStrings.xml
#   xl/worksheets/sheet1.xml
#   xl/worksheets/sheet2.xml
PY
```

Anything added here should be something a real workbook does. A fixture that
tests the reader against inventions tests nothing.
