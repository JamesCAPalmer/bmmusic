/**
 * Where we are in the church year.
 *
 * The feast-ahead panel (H11) and the scanning priority queue both need to know
 * what season it is, and half the year hangs off Easter, which moves by up to
 * five weeks. A fixed-date approximation would be wrong more years than it was
 * right, so this computes Easter properly and derives the movable seasons from
 * it.
 *
 * Scope, stated plainly: this is good enough to decide "which seasons should
 * the librarian be getting music ready for", which is a question with a month
 * of slack in it. It is **not** a lectionary and must never be used as one —
 * the estate has bmserviceapp for anything that has to be liturgically exact,
 * and this file has no business growing in that direction.
 *
 * Pure, so it can be tested against known dates.
 */

import { CHURCH } from "./church.config";

/** A day, as UTC midnight. All the arithmetic here is in whole days. */
function day(year: number, month: number, date: number): Date {
  return new Date(Date.UTC(year, month - 1, date));
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/**
 * Easter Sunday in the Gregorian calendar (the Meeus/Jones/Butcher algorithm).
 *
 * Reproduced rather than approximated because everything from Ash Wednesday to
 * Pentecost is counted from it, and being a week out would put the whole
 * Passiontide shelf in the wrong month.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return day(year, month, date);
}

/** Advent Sunday: the fourth Sunday before Christmas Day. */
export function adventSunday(year: number): Date {
  const christmas = day(year, 12, 25);
  // Back up to the Sunday on or before Christmas Eve, then three more weeks.
  const sundayBefore = addDays(christmas, -((christmas.getUTCDay() + 7) % 7 || 7));
  return addDays(sundayBefore, -21);
}

interface Window {
  season: string;
  from: Date;
  to: Date;
}

/**
 * The seasonal windows covering a given year.
 *
 * Deliberately overlapping in places — Passiontide sits inside Lent, Holy Week
 * inside Passiontide — because a piece tagged for any of them is worth having
 * ready, and the caller wants every applicable tag rather than one winner.
 */
function windowsFor(year: number): Window[] {
  const easter = easterSunday(year);
  const ashWednesday = addDays(easter, -46);
  const palmSunday = addDays(easter, -7);
  const ascension = addDays(easter, 39);
  const pentecost = addDays(easter, 49);
  const trinity = addDays(easter, 56);
  const advent = adventSunday(year);

  return [
    { season: "epiphany", from: day(year, 1, 6), to: day(year, 2, 1) },
    { season: "candlemas", from: day(year, 1, 28), to: day(year, 2, 8) },
    { season: "lent", from: ashWednesday, to: addDays(easter, -1) },
    { season: "passiontide", from: addDays(easter, -21), to: addDays(easter, -1) },
    { season: "holyweek", from: palmSunday, to: addDays(easter, -1) },
    { season: "easter", from: easter, to: pentecost },
    { season: "ascension", from: addDays(ascension, -3), to: addDays(ascension, 10) },
    { season: "pentecost", from: addDays(pentecost, -3), to: addDays(pentecost, 7) },
    { season: "trinity", from: trinity, to: advent },
    { season: "harvest", from: day(year, 9, 1), to: day(year, 10, 15) },
    { season: "allsaints", from: day(year, 10, 28), to: day(year, 11, 8) },
    { season: "remembrance", from: day(year, 11, 1), to: day(year, 11, 15) },
    { season: "advent", from: advent, to: day(year, 12, 24) },
    { season: "christmas", from: day(year, 12, 24), to: day(year + 1, 1, 6) },
  ];
}

/**
 * The seasons in play across a window starting at `now`.
 *
 * Looks `daysAhead` forward as well as at today, because the point is to get
 * music ready *before* the season arrives — telling a librarian on Palm Sunday
 * that it is Holy Week is not a service to anybody.
 *
 * Returned in the config's church-year order, so the panel reads the same way
 * every time.
 */
export function seasonsInPlay(now: Date, daysAhead = 45): string[] {
  const until = addDays(now, daysAhead);
  const years = new Set([now.getUTCFullYear() - 1, now.getUTCFullYear(), until.getUTCFullYear()]);

  const hit = new Set<string>();
  for (const year of years) {
    for (const w of windowsFor(year)) {
      // Any overlap between [now, until] and [from, to].
      if (w.from <= until && w.to >= now) hit.add(w.season);
    }
  }

  const ordered = CHURCH.seasons.map((s) => s.value).filter((v) => hit.has(v));
  // "general" is not a point in the year and should never be selected by date;
  // pieces tagged with it are always in play, which is not the same thing.
  return ordered.filter((s) => s !== "general");
}
