/**
 * Reading the estate's music feed.
 *
 * **Estate rule, non-negotiable:** bmserviceapp's daily cron is the estate's
 * only parser of the Minster's monthly music list. This app never fetches or
 * parses that document. What it does is read bmserviceapp's *output* — a JSON
 * feed at `GET /api/music?month=YYYY-MM` — and never anything else.
 *
 * The contract, as the live feed actually serves it:
 *
 *     {
 *       "month": "2026-08",
 *       "parsedAt": "2026-07-31T21:56:42.969Z",
 *       "sourceHash": "cef0e469a34ba24a",
 *       "sourceUrl": "https://beverleyminster.org.uk/.../August-Music-2026.docx",
 *       "parsedBy": "llm",
 *       "services": [
 *         {
 *           "date": "2026-08-02", "time": "11:00", "name": "Choral Eucharist",
 *           "choir": "Symbel choir",
 *           "setting": "Collegium Regale (Herbert Howells)",
 *           "motet": "Tantum ergo (Paul Brough)",
 *           "hymns": ["364", "26", "295", "231"]
 *         }
 *       ]
 *     }
 *
 * Two things about that shape drive the code below.
 *
 * **`sourceHash` is the hash-gate.** bmserviceapp already hashes the document
 * it parsed, so an unchanged month is one string comparison rather than a
 * diff of every service. We keep the last hash seen per month in `app_setting`
 * and do nothing at all when it has not moved.
 *
 * **Services have no id.** There is no field to key on, so `feed_ref` is
 * derived from date, time and name — the three things that identify a service
 * to a human reading the list. That derivation is the upsert key, so it has to
 * be stable: changing it would duplicate every service in the database.
 *
 * Everything here treats the feed as untrusted input. It is written by a
 * language model reading a Word document off a website, and it is occasionally
 * wrong in ways that are obvious to a person and invisible to a parser — the
 * live feed currently carries "Wiliam Byrd" and a choir called "RCSM". So every
 * field is checked for type before use, a bad service is skipped rather than
 * failing the whole month, and nothing is written that a human cannot correct.
 */

import { CHURCH } from "./church.config";
import type { Slot } from "./matcher";

/** One service, as the feed publishes it. Every field is optional but `date`. */
export interface FeedService {
  date?: unknown;
  time?: unknown;
  name?: unknown;
  choir?: unknown;
  responses?: unknown;
  psalm?: unknown;
  canticles?: unknown;
  setting?: unknown;
  introit?: unknown;
  anthem?: unknown;
  motet?: unknown;
  voluntary?: unknown;
  notes?: unknown;
  hymns?: unknown;
}

export interface FeedMonth {
  month?: unknown;
  sourceHash?: unknown;
  parsedAt?: unknown;
  services?: unknown;
}

export class FeedError extends Error {}

/** A service read out of the feed, with its music lines in order. */
export interface ReadService {
  feedRef: string;
  date: string;
  time: string | null;
  title: string;
  designation: string | null;
  music: ReadLine[];
}

export interface ReadLine {
  slot: Slot;
  rawText: string;
  position: number;
}

export interface ReadMonth {
  month: string;
  sourceHash: string | null;
  services: ReadService[];
  /** Services the feed offered that could not be read, and why. */
  skipped: { at: string; reason: string }[];
}

/**
 * Which feed field becomes which slot, and in what order they appear.
 *
 * The order is the order of a service, not the order of the JSON: a chorister
 * reading the home screen wants responses before the psalm before the
 * canticles, whatever order the parser happened to emit them in.
 */
const SINGLE_LINE_FIELDS: { field: keyof FeedService; slot: Slot }[] = [
  { field: "responses", slot: "responses" },
  { field: "psalm", slot: "psalm" },
  { field: "introit", slot: "introit" },
  { field: "canticles", slot: "canticles" },
  { field: "setting", slot: "setting" },
  { field: "anthem", slot: "anthem" },
  { field: "motet", slot: "motet" },
  { field: "voluntary", slot: "voluntary" },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^\d{1,2}:\d{2}$/;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * A stable identifier for a service the feed does not identify.
 *
 * Date, time and name: the three things that tell one service from another to
 * somebody reading the list. This is the upsert key, so it must never change
 * shape — a different derivation would duplicate every service already stored
 * rather than updating it.
 */
export function feedRefFor(date: string, time: string | null, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${date}T${time ?? "00:00"}-${slug}`;
}

/**
 * Read a month of the feed into services and music lines.
 *
 * Pure: takes the parsed JSON, returns what it means. A service that cannot be
 * read is skipped with a reason rather than throwing, because one malformed
 * entry in a month of forty should not cost the other thirty-nine.
 */
export function readFeedMonth(payload: FeedMonth): ReadMonth {
  const month = text(payload.month) ?? "";
  const sourceHash = text(payload.sourceHash);
  const services: ReadService[] = [];
  const skipped: { at: string; reason: string }[] = [];

  const raw = payload.services;
  if (!Array.isArray(raw)) {
    throw new FeedError("The feed did not include a list of services.");
  }

  const seen = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") {
      skipped.push({ at: `service ${index + 1}`, reason: "the entry was not a service" });
      continue;
    }
    const service = entry as FeedService;

    const date = text(service.date);
    if (!date || !ISO_DATE.test(date)) {
      skipped.push({ at: `service ${index + 1}`, reason: "no usable date" });
      continue;
    }

    const rawTime = text(service.time);
    const time = rawTime && CLOCK_TIME.test(rawTime) ? rawTime.padStart(5, "0") : null;
    const title = text(service.name) ?? "Service";

    const feedRef = feedRefFor(date, time, title);
    // Two entries deriving the same ref would fight over one row on every
    // fetch, each overwriting the other. Keep the first and say so.
    if (seen.has(feedRef)) {
      skipped.push({ at: `${date} ${time ?? ""} ${title}`.trim(), reason: "a second entry for the same service" });
      continue;
    }
    seen.add(feedRef);

    const music: ReadLine[] = [];
    let position = 0;

    for (const { field, slot } of SINGLE_LINE_FIELDS) {
      const value = text(service[field]);
      if (value) music.push({ slot, rawText: value, position: position++ });
    }

    // Hymns are a list of numbers into the hymn book, one line each so the
    // descant finder and the service page can address them individually.
    if (Array.isArray(service.hymns)) {
      for (const hymn of service.hymns) {
        const value = text(hymn) ?? (typeof hymn === "number" ? String(hymn) : null);
        if (value) music.push({ slot: "hymn", rawText: value, position: position++ });
      }
    }

    // The notes field carries real music often enough to be worth keeping —
    // "Coventry Gloria (Peter Jones), Sanctus and Agnus Dei" is a note in the
    // live feed. Filed as 'other', which is matchable but rarely matches.
    const notes = text(service.notes);
    if (notes) music.push({ slot: "other", rawText: notes, position: position++ });

    services.push({
      feedRef,
      date,
      time,
      title,
      designation: text(service.choir),
      music,
    });
  }

  return { month, sourceHash, services, skipped };
}

/**
 * Fetch one month of the feed.
 *
 * Read-only GET against the estate's data engine, server-side, exactly as
 * docs/API.md in the hub repo describes. The base URL and path come from
 * `church.config` so a fork points somewhere else by editing config.
 */
export async function fetchFeedMonth(month: string): Promise<FeedMonth> {
  const { baseUrl, musicPath } = CHURCH.estateApi;
  const url = `${baseUrl}${musicPath}?month=${encodeURIComponent(month)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      // The feed is a small JSON document that changes once a month. Letting
      // Cloudflare hold it briefly keeps an hourly cron from being rude.
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
  } catch {
    throw new FeedError("The music feed could not be reached.");
  }

  if (!response.ok) {
    throw new FeedError(`The music feed answered ${response.status} for ${month}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FeedError("The music feed did not return readable JSON.");
  }

  if (!payload || typeof payload !== "object") {
    throw new FeedError("The music feed returned something that was not a month.");
  }

  return payload as FeedMonth;
}

/** "2026-08" for a date, and the month after it. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The months a scheduled run should ask for.
 *
 * This month and next: the list for next month is published partway through
 * this one, and a chorister looking at the home screen on the 30th wants to see
 * what is coming. Going further out would ask for months that do not exist yet
 * and get `{"services": []}` for the trouble.
 */
export function monthsToFetch(now: Date): string[] {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return [monthKey(now), monthKey(next)];
}
