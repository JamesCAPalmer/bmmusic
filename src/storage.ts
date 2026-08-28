/**
 * storage — how a box's address is written down.
 *
 * A box lives behind a cupboard door and on a shelf within it, and its address
 * is a letter and a number: `D`, shelf 3. This module is the one place that
 * knows how to turn that letter into something a person reads.
 *
 * **Why it is not in `church.config.ts`.** That module is pure data by estate
 * rule — no imports, no functions, no side effects — and these are functions.
 * Putting them here keeps the rule intact while still leaving exactly one
 * source of truth: the cupboards themselves are config, and everything below
 * only reads them.
 *
 * **Why it is not in a UI module.** Three callers need the same answer — the
 * screens, the printed label sheet and the route that validates a submitted
 * door — and two copies of "how do you write a cupboard's name" is how the
 * label on the spine and the label on the screen come to disagree.
 *
 * ---
 *
 * **The cupboards have names, and the names are diesel locomotive classes.**
 * Robert is a railway enthusiast and puts trains wherever he can get away with
 * one, and this is a good place for it. "It's in Deltic" survives being shouted
 * across a song school; "it's in D" is heard as "in B" and the volunteer opens
 * the wrong cupboard. A name is memorable exactly because it is not derivable
 * from its position.
 *
 * **The letter is stored; the name is only ever displayed.** Every
 * `holding.location_door` in D1 holds the letter, every label already stuck to
 * a spine carries the letter, and every volunteer who has learned the wall
 * knows the letter. So the names cost nothing to change and nothing to remove:
 * edit `CHURCH.storage.doors` and no migration, reprint or recount follows.
 * That is the whole reason it is safe to have a joke here at all.
 */

import { CHURCH, type StorageDoor } from "./church.config";

/** Just the letters, which is what D1 and the printed labels hold. */
export function doorLetters(): string[] {
  return CHURCH.storage.doors.map((d) => d.letter);
}

/** Is this a cupboard we know about? The check every writing path runs. */
export function isDoorLetter(value: string): boolean {
  return CHURCH.storage.doors.some((d) => d.letter === value);
}

/** The cupboard with this letter, or null if there is none. */
export function doorByLetter(letter: string): StorageDoor | null {
  return CHURCH.storage.doors.find((d) => d.letter === letter) ?? null;
}

/**
 * How a cupboard is written on screen: `A · Deltic`.
 *
 * Letter first, always. The letter is painted on the door and printed on the
 * spine, so it is what somebody standing in front of the cupboard is matching
 * against; the name is what they remembered on the way there.
 *
 * An unknown letter renders as itself rather than as an error or a blank. A
 * holding whose door has since been taken out of the config should still say
 * where the box is — "F, shelf 2" is worth vastly more to somebody looking for
 * it than "unknown".
 */
export function doorLabel(letter: string): string {
  const door = doorByLetter(letter);
  return door ? `${door.letter} · ${door.name}` : letter;
}

/** `A · Deltic (Class 55)` — the long form, for pickers and help text. */
export function doorLabelLong(letter: string): string {
  const door = doorByLetter(letter);
  return door ? `${door.letter} · ${door.name} (${door.loco})` : letter;
}

/**
 * A box's full address: `A · Deltic, shelf 3`.
 *
 * Null when there is no door recorded, because a shelf number on its own is
 * not an address — there are eight shelf 3s.
 */
export function shelfAddress(letter: string | null, shelf: number | null): string | null {
  if (!letter) return null;
  return shelf ? `${doorLabel(letter)}, shelf ${shelf}` : doorLabel(letter);
}
