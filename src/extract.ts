/**
 * Reading a photograph of a parcel label into fields a human then checks.
 *
 * This follows vestry's upload → extract → review → confirm shape, and it holds
 * to the same rule: **extraction never guesses silently**. Every field comes
 * back with a confidence and the verbatim text it was read from, the review
 * form shows both, and nothing reaches the catalogue until somebody presses
 * confirm.
 *
 * The prompt lives in `docs/PIPELINE.md` as well as here — that document is
 * what James reads when the labels change and the readings get worse. Keep the
 * two in step.
 *
 * With `ANTHROPIC_API_KEY` unset the caller gets `NotConfiguredError` and the
 * intake screen falls back to a blank manual form, because a volunteer holding
 * a parcel in a cold song school should not meet an error page.
 */

import { CHURCH } from "./church.config";
import { completeJson, NotConfiguredError, SONNET, type ContentBlock } from "./anthropic";
import type { Env } from "./env";

/** One field as read: what it says, and how sure the reading is. */
export interface ReadField<T> {
  value: T | null;
  /** 0–1. Below 0.8 the review form highlights it. */
  confidence: number;
  /** The characters actually on the label, before any tidying. */
  verbatim: string | null;
}

export interface ExtractedLabel {
  composer: ReadField<string>;
  /** Every title on the parcel, in the order they are written. */
  titles: { value: string; confidence: number }[];
  category: ReadField<string>;
  voicing: ReadField<string>;
  season: ReadField<string>;
  location: ReadField<string>;
  copiesTotal: ReadField<number>;
  /** Anything else written on the label that does not fit a field. */
  otherText: string | null;
  /** The model's own reasons a human should look at this one. */
  concerns: string[];
}

const CATEGORY_CODES = CHURCH.categories.map((c) => c.code);

/**
 * The label-reading prompt.
 *
 * Written against what the labels actually are: parcels wrapped decades ago,
 * many labels handwritten, some in more than one hand, plenty with a pencilled
 * box number or an old reference that means nothing now. The three instructions
 * that matter are: read, do not interpret; leave a field null rather than
 * complete it from knowledge of the repertoire; and say when you are unsure.
 */
export const LABEL_PROMPT = `You are reading a photograph of a label on a parcel or box of choral music in the song school at ${CHURCH.name}. Somebody will check everything you return, so your job is to read accurately and to be honest about what you cannot read — not to produce a tidy answer.

Return what the label says, and only what the label says.

Rules:

1. Read, do not interpret. If the label says "BAIRSTOW", the composer is "BAIRSTOW", not "Sir Edward Bairstow". If a word is half-legible, give your best reading and lower the confidence.
2. Never complete a field from your own knowledge of the repertoire. If the label gives a title but no composer, the composer is null — even when you are certain who wrote it. Somebody who knows this library will fill it in.
3. Set every confidence honestly, 0 to 1. Handwritten, faded, or ambiguous readings should be well below 1. A confidence above 0.9 means you could read it as plainly as print.
4. Put the characters you actually see in "verbatim", before any tidying: keep the label's capitalisation, its abbreviations ("Mag & Nunc"), and its question marks.
5. A parcel often holds several pieces. List every title separately, in the order written. Do not merge them and do not invent a collective title.
6. Category must be one of these codes, or null when the label does not settle it:
${CHURCH.categories.map((c) => `   ${c.code} — ${c.label}: ${c.blurb}`).join("\n")}
   Choose null rather than guessing between two. A setting filed by key alone ("in E flat") is usually evening canticles (E), but say so in "concerns" if that is the only reason.
7. Voicing is what is written (SATB, SS, ATB, unison, "Trebles"). Do not deduce it from the composer or the piece.
8. Season is only what is written (Advent, Lent, Easter, Christmas, Passiontide).
9. Location is any shelf, box or parcel marking — "Box 4", "pencil 44 on box", a cupboard name.
10. If the label gives a number of copies, put it in copiesTotal. A pencilled number that might be a copy count or might be a box number goes in otherText, with a note in "concerns" — do not guess which it is.
11. Put anything else written on the label into otherText verbatim: old references, "see also" notes, publisher names, donors' names.
12. Use "concerns" for anything a human should look at: an unreadable word, two possible readings, a damaged label, a cross-reference to another parcel, the reason a category was a guess.

If the photograph shows no readable label at all, return nulls with confidence 0 and say so in "concerns". Do not describe the photograph.`;

const READ_FIELD_SCHEMA = (type: string) => ({
  type: "object",
  properties: {
    value: { type: [type, "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    verbatim: { type: ["string", "null"] },
  },
  required: ["value", "confidence", "verbatim"],
  additionalProperties: false,
});

const LABEL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    composer: READ_FIELD_SCHEMA("string"),
    titles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          value: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["value", "confidence"],
        additionalProperties: false,
      },
    },
    category: {
      type: "object",
      properties: {
        value: { type: ["string", "null"], enum: [...CATEGORY_CODES, null] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        verbatim: { type: ["string", "null"] },
      },
      required: ["value", "confidence", "verbatim"],
      additionalProperties: false,
    },
    voicing: READ_FIELD_SCHEMA("string"),
    season: READ_FIELD_SCHEMA("string"),
    location: READ_FIELD_SCHEMA("string"),
    copiesTotal: READ_FIELD_SCHEMA("integer"),
    otherText: { type: ["string", "null"] },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: [
    "composer",
    "titles",
    "category",
    "voicing",
    "season",
    "location",
    "copiesTotal",
    "otherText",
    "concerns",
  ],
  additionalProperties: false,
};

/** Is label reading available at all? The intake screen asks before offering it. */
export function extractionAvailable(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Read one label photograph.
 *
 * Throws `NotConfiguredError` when there is no API key, which the route turns
 * into the manual-entry fallback rather than an error.
 */
export async function extractLabel(env: Env, image: ContentBlock): Promise<ExtractedLabel> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new NotConfiguredError("Label reading is not configured — enter the details by hand.");
  }

  const raw = await completeJson<ExtractedLabel>({
    apiKey: env.ANTHROPIC_API_KEY,
    model: SONNET,
    system: LABEL_PROMPT,
    content: [image, { type: "text", text: "Read this label." }],
    jsonSchema: LABEL_SCHEMA,
    maxTokens: 2048,
  });

  return normalise(raw);
}

/**
 * Tidy the response into something the review form can rely on.
 *
 * The schema constrains the shape, but a missing array or an out-of-range
 * confidence should not reach the form as `undefined` and render as "NaN" in
 * front of a volunteer.
 */
function normalise(raw: ExtractedLabel): ExtractedLabel {
  const field = <T>(f: ReadField<T> | undefined): ReadField<T> => ({
    value: f?.value ?? null,
    confidence: clamp(f?.confidence),
    verbatim: f?.verbatim ?? null,
  });

  return {
    composer: field(raw.composer),
    titles: (raw.titles ?? [])
      .filter((t) => t && typeof t.value === "string" && t.value.trim() !== "")
      .map((t) => ({ value: t.value.trim(), confidence: clamp(t.confidence) })),
    category: field(raw.category),
    voicing: field(raw.voicing),
    season: field(raw.season),
    location: field(raw.location),
    copiesTotal: field(raw.copiesTotal),
    otherText: raw.otherText ?? null,
    concerns: Array.isArray(raw.concerns) ? raw.concerns.filter((c) => typeof c === "string") : [],
  };
}

function clamp(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(Math.max(v, 0), 1);
}

/** Below this a field is highlighted in the review form. */
export const LOW_CONFIDENCE = 0.8;
