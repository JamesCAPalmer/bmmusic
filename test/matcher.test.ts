/**
 * The matcher and the feed reader.
 *
 * Every music-list line quoted here is a real one, copied from the live
 * bmserviceapp feed (`/api/music?month=…` for May to August 2026). That
 * matters more than it sounds: the feed is written by a language model reading
 * a Word document off a website, and its quirks — "Wiliam Byrd", a choir called
 * "RCSM", a canticle published as nothing but a composer and a key — are the
 * whole reason the matcher is fuzzy. Testing against tidied-up examples would
 * test a feed that does not exist.
 */

import { describe, expect, it } from "vitest";
import {
  isMatchable,
  matchLine,
  normaliseMatchKey,
  parseMusicLine,
  scoreCandidate,
  type CorpusPiece,
} from "../src/matcher";
import { feedRefFor, monthsToFetch, readFeedMonth, FeedError } from "../src/feed";

// ---------------------------------------------------------------------------

describe("reading a music-list line apart", () => {
  it("takes the composer out of the trailing parenthesis", () => {
    expect(parseMusicLine("Ave verum corpus (Wiliam Byrd)", "anthem")).toEqual({
      title: "Ave verum corpus",
      composer: "Wiliam Byrd",
      key: null,
    });
  });

  it("takes an apostrophe in a composer's name in its stride", () => {
    expect(parseMusicLine("King's College Service (Joanna Forbes L'Estrange)", "canticles")).toEqual({
      title: "King's College Service",
      composer: "Joanna Forbes L'Estrange",
      key: null,
    });
  });

  // Canticles are the hard slot: the Minster publishes them as a composer and a
  // key, with no title at all.
  it("reads a canticle published as a composer and a key", () => {
    expect(parseMusicLine("Charles Villiers Stanford in C", "canticles")).toEqual({
      title: null,
      composer: "Charles Villiers Stanford",
      key: "C",
    });
    expect(parseMusicLine("Herbert Brewer in D", "canticles")).toMatchObject({ composer: "Herbert Brewer", key: "D" });
  });

  it("keeps a flat or a minor with the key", () => {
    expect(parseMusicLine("Francis Jackson in G minor", "canticles").key).toBe("G minor");
    expect(parseMusicLine("Herbert Howells in B flat", "canticles").key).toBe("B flat");
  });

  // "in" is a common word. Anchoring on a real key name is what stops a title
  // being read as a composer.
  it("does not read every word after 'in' as a key", () => {
    expect(parseMusicLine("Rejoice in the Lord alway", "anthem")).toEqual({
      title: "Rejoice in the Lord alway",
      composer: null,
      key: null,
    });
  });

  // The responses column carries a bare composer. Reading it as a title would
  // match nothing, every single week.
  it("reads the responses as a composer, not a title", () => {
    expect(parseMusicLine("Bernard Rose", "responses")).toEqual({
      title: null,
      composer: "Bernard Rose",
      key: null,
    });
  });

  it("reads the same words as a title when they are the anthem", () => {
    expect(parseMusicLine("Bernard Rose", "anthem")).toEqual({
      title: "Bernard Rose",
      composer: null,
      key: null,
    });
  });

  it("finds nothing to match in a psalm or a hymn number", () => {
    expect(parseMusicLine("80 vv1-8", "psalm")).toEqual({ title: null, composer: null, key: null });
    expect(parseMusicLine("364", "hymn")).toEqual({ title: null, composer: null, key: null });
  });

  it("survives an empty line", () => {
    expect(parseMusicLine("", "anthem")).toEqual({ title: null, composer: null, key: null });
    expect(parseMusicLine("   ", "anthem")).toEqual({ title: null, composer: null, key: null });
  });
});

// ---------------------------------------------------------------------------

describe("which slots are worth matching", () => {
  it("matches the choral slots", () => {
    for (const slot of ["responses", "canticles", "setting", "introit", "anthem", "motet"] as const) {
      expect(isMatchable(slot), slot).toBe(true);
    }
  });

  // A psalm is a number and a pointing, a hymn is a number in the hymn book,
  // and a voluntary lives on the organ loft. Offering parcels for those would
  // put three lines of noise in the review queue every week.
  it("leaves the psalm, the hymns and the voluntary alone", () => {
    for (const slot of ["psalm", "hymn", "voluntary"] as const) {
      expect(isMatchable(slot), slot).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the key a learned match is remembered under", () => {
  it("folds case, punctuation and spacing", () => {
    expect(normaliseMatchKey("Ave verum corpus (Wiliam Byrd)")).toBe("ave verum corpus wiliam byrd");
    expect(normaliseMatchKey("  AVE  VERUM   CORPUS (WILIAM BYRD)  ")).toBe("ave verum corpus wiliam byrd");
  });

  // Keeping the composer in the key is what stops two settings of the same
  // words collapsing onto one learned match.
  it("keeps two composers' settings of the same words apart", () => {
    expect(normaliseMatchKey("in C (Stanford)")).not.toBe(normaliseMatchKey("in C (Wood)"));
  });
});

// ---------------------------------------------------------------------------

describe("matching against the catalogue", () => {
  // Shaped like the real thing: the label shouts a surname, the catalogue also
  // holds the name written out, and a multi-title parcel carries its parts as
  // aliases.
  const corpus: CorpusPiece[] = [
    { id: 1, titles: ["Ave verum corpus"], composers: ["BYRD", "William Byrd", "Byrd"] },
    { id: 2, titles: ["Ave verum corpus"], composers: ["ELGAR", "Edward Elgar", "Elgar"] },
    { id: 3, titles: ["Evening Service in C"], composers: ["STANFORD", "Charles Villiers Stanford", "Stanford"] },
    { id: 4, titles: ["Evening Service in B flat"], composers: ["STANFORD", "Charles Villiers Stanford", "Stanford"] },
    {
      id: 5,
      titles: ["O sing joyfully; Deliver us O Lord; O praise the Lord", "O sing joyfully", "Deliver us O Lord", "O praise the Lord"],
      composers: ["BATTEN", "Adrian Batten", "Batten"],
    },
    { id: 6, titles: ["Preces and Responses"], composers: ["ROSE", "Bernard Rose", "Rose"] },
  ];

  it("matches an anthem on title and composer together", () => {
    const match = matchLine("Ave verum corpus (Wiliam Byrd)", "anthem", corpus);
    expect(match?.pieceId).toBe(1);
    expect(match?.state).toBe("auto");
  });

  // The trap this is built to avoid: the library holds four settings of
  // "Ave verum corpus", and the title alone cannot tell them apart.
  it("uses the composer to tell two settings of the same words apart", () => {
    expect(matchLine("Ave verum (Edward Elgar)", "anthem", corpus)?.pieceId).toBe(2);
    expect(matchLine("Ave verum corpus (Wiliam Byrd)", "anthem", corpus)?.pieceId).toBe(1);
  });

  it("finds a multi-title parcel by one of its parts", () => {
    expect(matchLine("O sing joyfully (Adrian Batten)", "introit", corpus)?.pieceId).toBe(5);
  });

  it("matches the responses on the composer alone", () => {
    expect(matchLine("Bernard Rose", "responses", corpus)?.pieceId).toBe(6);
  });

  it("uses the key to choose between one composer's settings", () => {
    expect(matchLine("Charles Villiers Stanford in C", "canticles", corpus)?.pieceId).toBe(3);
    expect(matchLine("Charles Villiers Stanford in B flat", "canticles", corpus)?.pieceId).toBe(4);
  });

  // A bug this had first time round, and the reason keys are compared on whole
  // words rather than as substrings: a bare "C" appears inside "evening
  // servi(c)e", so every setting matched every key, nothing was ever clear of
  // its runner-up, and every canticle in the feed came back unmatched.
  it("does not find the key 'C' hiding inside the word 'service'", () => {
    const inBFlatOnly: CorpusPiece[] = [
      { id: 20, titles: ["Evening Service in B flat"], composers: ["STANFORD", "Charles Villiers Stanford"] },
    ];
    expect(matchLine("Charles Villiers Stanford in C", "canticles", inBFlatOnly)?.score).toBeLessThan(0.9);
  });

  it("matches a key against a parcel catalogued with the mode spelled out", () => {
    const spelledOut: CorpusPiece[] = [
      { id: 21, titles: ["Magnificat and Nunc Dimittis in C major"], composers: ["WOOD", "Charles Wood"] },
      { id: 22, titles: ["Magnificat and Nunc Dimittis in D minor"], composers: ["WOOD", "Charles Wood"] },
    ];
    expect(matchLine("Charles Wood in C", "canticles", spelledOut)?.pieceId).toBe(21);
  });

  // The property that keeps the wrong parcel off a chorister's service page:
  // where the matcher cannot tell two candidates apart, it says so.
  it("declines rather than guessing between two settings it cannot separate", () => {
    const ambiguous: CorpusPiece[] = [
      { id: 10, titles: ["Evening Service"], composers: ["STANFORD", "Charles Villiers Stanford"] },
      { id: 11, titles: ["Evening Service"], composers: ["STANFORD", "Charles Villiers Stanford"] },
    ];
    expect(matchLine("Charles Villiers Stanford", "canticles", ambiguous)).toBeNull();
  });

  it("declines a line with nothing in the library behind it", () => {
    expect(matchLine("Tune me, O Lord (Lucy Walker)", "introit", corpus)).toBeNull();
  });

  // Both of these are real false positives that a dry run over four months of
  // the live feed produced, and both came from the same flaw: scoring the
  // shared words against the *shorter* of the two titles, so a long line could
  // match a short parcel on one word it happened to share.
  //
  // The library holds fifteen Stanford parcels and several Handel ones. Landing
  // on the wrong one is worse than landing on none: an unmatched line is a tap
  // in the admin queue, and a wrong one is a chorister sent to the wrong
  // parcel with nobody any the wiser until the rehearsal.
  it("does not settle on a parcel by the right composer that shares one stray word", () => {
    const stanford: CorpusPiece[] = [
      {
        id: 30,
        titles: ["Let Thy hand be strengthened; O pray for the peace; My God, my God"],
        composers: ["STANFORD", "Charles Villiers Stanford", "Stanford"],
      },
    ];
    expect(matchLine("O for a closer walk with God (Charles Villiers Stanford)", "anthem", stanford)).toBeNull();
  });

  it("does not match a short alias that shares a single common word", () => {
    const handel: CorpusPiece[] = [
      {
        id: 31,
        titles: ["Since by man came death; Behold the Lamb of God", "Behold the Lamb of God"],
        composers: ["HANDEL", "George Frideric Handel", "Handel"],
      },
    ];
    expect(matchLine("Lord, I trust thee (George Frederick Handel)", "introit", handel)).toBeNull();
  });

  // The other side of that same measure: extra words in the parcel's title are
  // usually the library's own cataloguing, not a different piece.
  it("still matches a parcel catalogued with an opus number after the title", () => {
    const rheinberger: CorpusPiece[] = [
      { id: 32, titles: ["Abendlied (Op. 69 No. 3)"], composers: ["RHEINBERGER", "Josef Rheinberger"] },
    ];
    expect(matchLine("Abendlied (Josef Rheinberger)", "motet", rheinberger)?.pieceId).toBe(32);
  });

  it("still matches a mass the library files under its catalogue name", () => {
    const mozart: CorpusPiece[] = [
      { id: 33, titles: ["Missa brevis in C (Spatzenmesse KV220)"], composers: ["MOZART", "Wolfgang Amadeus Mozart"] },
    ];
    expect(matchLine("Spatzenmesse (Wolfgang Amadeus Mozart)", "setting", mozart)?.pieceId).toBe(33);
  });

  // Three Sumsion services, none of which the line's key settles. Declining is
  // the right answer, and it is the margin rule rather than the threshold that
  // produces it.
  it("declines between three settings by one composer when the key does not separate them", () => {
    const sumsion: CorpusPiece[] = [
      { id: 40, titles: ["in G (Mag & Nunc)"], composers: ["SUMSION", "Herbert Sumsion", "Sumsion"] },
      { id: 41, titles: ["in A (+ in C?)"], composers: ["SUMSION", "Herbert Sumsion", "Sumsion"] },
      { id: 42, titles: ["in D and G (Treble only)"], composers: ["SUMSION", "Herbert Sumsion", "Sumsion"] },
    ];
    expect(matchLine("Herbert Sumsion in A", "canticles", sumsion)).toBeNull();
  });

  it("never offers a match for a psalm or a hymn", () => {
    expect(matchLine("80 vv1-8", "psalm", corpus)).toBeNull();
    expect(matchLine("364", "hymn", corpus)).toBeNull();
  });

  // What the whole feature exists for: James confirms a phrasing once.
  it("reuses what a human has already confirmed, without re-deciding", () => {
    const learned = new Map([[normaliseMatchKey("Coll Reg (H Howells)"), 3]]);
    const match = matchLine("Coll Reg (H Howells)", "canticles", corpus, learned);
    expect(match).toEqual({ pieceId: 3, score: 1, state: "confirmed" });
  });

  it("prefers what a human said over what it would have guessed itself", () => {
    const learned = new Map([[normaliseMatchKey("Ave verum corpus (Wiliam Byrd)"), 2]]);
    expect(matchLine("Ave verum corpus (Wiliam Byrd)", "anthem", corpus, learned)?.pieceId).toBe(2);
  });

  it("finds nothing in an empty catalogue rather than falling over", () => {
    expect(matchLine("Ave verum corpus (Wiliam Byrd)", "anthem", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("scoring", () => {
  const byrd: CorpusPiece = { id: 1, titles: ["Ave verum corpus"], composers: ["BYRD", "William Byrd", "Byrd"] };

  it("scores an exact title and composer at the top", () => {
    expect(scoreCandidate({ title: "Ave verum corpus", composer: "William Byrd", key: null }, byrd)).toBe(1);
  });

  // A different composer's setting of the same words must score below a match,
  // not above it — this is the failure that would put the wrong parcel out.
  it("scores the right words by the wrong composer below the threshold", () => {
    const wrong = scoreCandidate({ title: "Ave verum corpus", composer: "Edward Elgar", key: null }, byrd);
    const right = scoreCandidate({ title: "Ave verum corpus", composer: "William Byrd", key: null }, byrd);
    expect(wrong).toBeLessThan(right);
  });

  it("scores nothing for a composer who is not this one", () => {
    expect(scoreCandidate({ title: null, composer: "Edward Elgar", key: null }, byrd)).toBe(0);
  });

  // The parcel's shouted surname must appear inside the feed's written-out
  // name, not the other way about — otherwise a surname matches everything.
  it("matches a shouted surname inside a written-out name", () => {
    expect(scoreCandidate({ title: null, composer: "Charles Villiers Stanford", key: null }, {
      id: 9,
      titles: ["Evening Service"],
      composers: ["STANFORD"],
    })).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("reading a month of the feed", () => {
  // Trimmed from the live response for 2026-08.
  const month = {
    month: "2026-08",
    parsedAt: "2026-07-31T21:56:42.969Z",
    sourceHash: "cef0e469a34ba24a",
    services: [
      {
        date: "2026-08-01",
        time: "17:00",
        name: "Choral Evensong",
        choir: "Symbel choir",
        responses: "Esther Bersweden",
        psalm: "6",
        canticles: "King's College Service (Joanna Forbes L'Estrange)",
        introit: "Tune me, O Lord (Lucy Walker)",
        anthem: "Seek Him that maketh the seven stars (Jonathan Dove)",
        hymns: ["285"],
      },
      {
        date: "2026-08-02",
        time: "11:00",
        name: "Choral Eucharist",
        choir: "Symbel choir",
        setting: "Collegium Regale (Herbert Howells)",
        motet: "Tantum ergo (Paul Brough)",
        hymns: ["364", "26", "295", "231"],
      },
    ],
  };

  it("reads every service and carries the source hash", () => {
    const read = readFeedMonth(month);
    expect(read.month).toBe("2026-08");
    expect(read.sourceHash).toBe("cef0e469a34ba24a");
    expect(read.services).toHaveLength(2);
  });

  // Service order, not JSON order: a chorister wants responses before the
  // psalm before the canticles, whatever order the parser emitted them in.
  it("puts the music in the order a service happens in", () => {
    const [evensong] = readFeedMonth(month).services;
    expect(evensong!.music.map((m) => m.slot)).toEqual([
      "responses",
      "psalm",
      "introit",
      "canticles",
      "anthem",
      "hymn",
    ]);
  });

  it("gives each hymn its own line", () => {
    const eucharist = readFeedMonth(month).services[1]!;
    expect(eucharist.music.filter((m) => m.slot === "hymn").map((m) => m.rawText)).toEqual([
      "364",
      "26",
      "295",
      "231",
    ]);
  });

  it("takes the choir designation for the copies RAG", () => {
    expect(readFeedMonth(month).services[0]!.designation).toBe("Symbel choir");
  });

  it("numbers the positions from zero without a gap", () => {
    for (const service of readFeedMonth(month).services) {
      expect(service.music.map((m) => m.position)).toEqual(service.music.map((_, i) => i));
    }
  });

  // The feed publishes no id for a service, so the upsert key is derived. It
  // must be stable: a different derivation would duplicate every service
  // already in the database rather than updating it.
  it("derives a stable reference from date, time and name", () => {
    expect(feedRefFor("2026-08-02", "11:00", "Choral Eucharist")).toBe("2026-08-02T11:00-choral-eucharist");
    expect(readFeedMonth(month).services[0]!.feedRef).toBe("2026-08-01T17:00-choral-evensong");
  });

  it("still identifies a service the list gives no time for", () => {
    const read = readFeedMonth({ ...month, services: [{ date: "2026-08-09", name: "Evening Prayer" }] });
    expect(read.services[0]!.feedRef).toBe("2026-08-09T00:00-evening-prayer");
    expect(read.services[0]!.time).toBeNull();
  });

  // One malformed entry in a month of forty must not cost the other
  // thirty-nine, so a bad service is skipped with a reason rather than thrown.
  it("skips a service it cannot read and says why", () => {
    const read = readFeedMonth({
      ...month,
      services: [{ date: "2026-08-01", time: "17:00", name: "Choral Evensong" }, { name: "no date at all" }, null],
    });
    expect(read.services).toHaveLength(1);
    expect(read.skipped).toHaveLength(2);
    expect(read.skipped[0]!.reason).toContain("date");
  });

  it("keeps the first of two entries claiming the same service", () => {
    const read = readFeedMonth({
      ...month,
      services: [
        { date: "2026-08-01", time: "17:00", name: "Choral Evensong", anthem: "First" },
        { date: "2026-08-01", time: "17:00", name: "Choral Evensong", anthem: "Second" },
      ],
    });
    expect(read.services).toHaveLength(1);
    expect(read.services[0]!.music[0]!.rawText).toBe("First");
    expect(read.skipped[0]!.reason).toContain("second entry");
  });

  it("takes a null choir, which the live feed does publish", () => {
    const read = readFeedMonth({ ...month, services: [{ date: "2026-08-09", name: "Evening Prayer", choir: null }] });
    expect(read.services[0]!.designation).toBeNull();
  });

  it("keeps the notes field, which carries real music", () => {
    const read = readFeedMonth({
      ...month,
      services: [{ date: "2026-08-09", name: "Eucharist", notes: "Coventry Gloria (Peter Jones), Sanctus and Agnus Dei" }],
    });
    expect(read.services[0]!.music[0]).toMatchObject({ slot: "other" });
  });

  it("reads an empty month without complaint", () => {
    expect(readFeedMonth({ month: "2026-09", services: [] }).services).toEqual([]);
  });

  it("refuses a payload with no list of services at all", () => {
    expect(() => readFeedMonth({ month: "2026-09" })).toThrow(FeedError);
    expect(() => readFeedMonth({ month: "2026-09", services: "soon" })).toThrow(FeedError);
  });
});

// ---------------------------------------------------------------------------

describe("which months to fetch", () => {
  // Next month's list is published partway through this one, and a chorister
  // looking at the home screen on the 30th wants to see what is coming.
  it("asks for this month and next", () => {
    expect(monthsToFetch(new Date("2026-08-27T09:00:00Z"))).toEqual(["2026-08", "2026-09"]);
  });

  it("rolls over the year end", () => {
    expect(monthsToFetch(new Date("2026-12-15T09:00:00Z"))).toEqual(["2026-12", "2027-01"]);
  });
});
