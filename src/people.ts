/**
 * People and the register (**beta**).
 *
 * **This is personal data about identifiable people, several of them
 * children.** Everything in this module is written to that standard:
 *
 *   - Names only. No email, no telephone, no address, no date of birth. The
 *     `person` table has no columns for any of them, and a test asserts it.
 *   - Admin side only. Nothing on the choir side reads `person` or
 *     `attendance`, and no choir-side route touches this module. A chorister
 *     must never be able to see another chorister's attendance record.
 *   - Never in a log line, never in analytics, and deliberately **not in the
 *     audit log** — that is a log admins read looking for a mistake, and a
 *     child's attendance has no business scrolling past in it. Each attendance
 *     row carries its own `marked_by` instead, which is where the accountability
 *     belongs.
 *   - A person who leaves is marked inactive rather than deleted, so past
 *     registers still read. Deletion is available and is a real delete.
 */

import { CHURCH } from "./church.config";

export interface PersonRow {
  id: number;
  display_name: string;
  choir: string;
  voice_part: string | null;
  active: number;
}

export interface RegisterRow extends PersonRow {
  /** 'present' | 'absent' | 'excused', or null when not yet marked. */
  status: string | null;
  marked_by: string | null;
}

/** Choirs a person can belong to. Mirrors the CHECK in migration 0002. */
export const CHOIRS = [
  { value: "boys", label: "Boys" },
  { value: "girls", label: "Girls" },
  { value: "consort", label: "Consort" },
  { value: "satb", label: "SATB" },
] as const;

export function isChoir(value: string): boolean {
  return CHOIRS.some((c) => c.value === value);
}

export function isVoicePart(value: string): boolean {
  return CHURCH.voiceParts.some((v) => v.value === value);
}

export async function listPeople(db: D1Database, includeInactive = false): Promise<PersonRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, display_name, choir, voice_part, active FROM person
        ${includeInactive ? "" : "WHERE active = 1"}
        ORDER BY choir, display_name`
    )
    .all<PersonRow>();
  return rows.results ?? [];
}

export async function addPerson(
  db: D1Database,
  person: { displayName: string; choir: string; voicePart: string | null }
): Promise<number> {
  const row = await db
    .prepare(`INSERT INTO person (display_name, choir, voice_part) VALUES (?, ?, ?) RETURNING id`)
    .bind(person.displayName.trim(), person.choir, person.voicePart)
    .first<{ id: number }>();
  if (!row) throw new Error("That person could not be saved.");
  return row.id;
}

export async function setPersonActive(db: D1Database, id: number, active: boolean): Promise<void> {
  await db
    .prepare(
      `UPDATE person SET active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    )
    .bind(active ? 1 : 0, id)
    .run();
}

/**
 * Remove somebody entirely.
 *
 * A real delete, and it takes their attendance with it by cascade. Marking
 * inactive is the usual answer — it keeps past registers readable — but if a
 * parent asks for their child's record to be removed, that has to actually
 * happen, so it is here.
 */
export async function deletePerson(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM person WHERE id = ?`).bind(id).run();
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/**
 * Which choirs a service's designation calls for.
 *
 * The music list writes designations like "Boys and SATB", "Girls and Team B",
 * "Consort and Girls" — prose, not codes. Matching is on the words present, so
 * "Boys and SATB" expects the boys and the SATB singers.
 *
 * A designation naming none of them (a visiting choir, "Symbel choir", the
 * "RCSM") expects **everybody**, not nobody: showing an empty register at the
 * door is worse than showing a long one, because the person holding the phone
 * cannot tell it apart from a bug.
 */
export function choirsExpectedFor(designation: string | null): string[] {
  const text = (designation ?? "").toLowerCase();
  const expected = CHOIRS.filter((c) => text.includes(c.value)).map((c) => c.value);
  return expected.length ? expected : CHOIRS.map((c) => c.value);
}

/** The register for one service: everybody expected, with whatever is marked. */
export async function registerFor(
  db: D1Database,
  serviceId: number,
  designation: string | null
): Promise<RegisterRow[]> {
  const choirs = choirsExpectedFor(designation);
  const placeholders = choirs.map(() => "?").join(",");

  const rows = await db
    .prepare(
      `SELECT p.id, p.display_name, p.choir, p.voice_part, p.active,
              a.status, a.marked_by
         FROM person p
         LEFT JOIN attendance a ON a.person_id = p.id AND a.service_id = ?
        WHERE p.active = 1 AND p.choir IN (${placeholders})
        ORDER BY p.choir, p.display_name`
    )
    .bind(serviceId, ...choirs)
    .all<RegisterRow>();

  return rows.results ?? [];
}

/**
 * Mark one person at one service.
 *
 * An upsert, because the register is tapped down a list at the door on an
 * iPhone and each tap cycles present → absent → excused. A second tap on the
 * same name must replace the first, not pile a row on top of it.
 */
export async function markAttendance(
  db: D1Database,
  serviceId: number,
  personId: number,
  status: string,
  who: string
): Promise<void> {
  if (!["present", "absent", "excused"].includes(status)) {
    throw new Error("That is not one of the three things a register records.");
  }
  await db
    .prepare(
      `INSERT INTO attendance (service_id, person_id, status, marked_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (service_id, person_id) DO UPDATE SET
         status = excluded.status, marked_by = excluded.marked_by,
         marked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
    .bind(serviceId, personId, status, who)
    .run();
}

/** What a tap moves to. Unmarked → present → absent → excused → unmarked. */
export function nextStatus(current: string | null): string | null {
  switch (current) {
    case null:
      return "present";
    case "present":
      return "absent";
    case "absent":
      return "excused";
    default:
      return null;
  }
}

/** Clear a mark, for when somebody taps one name too many. */
export async function clearAttendance(db: D1Database, serviceId: number, personId: number): Promise<void> {
  await db
    .prepare(`DELETE FROM attendance WHERE service_id = ? AND person_id = ?`)
    .bind(serviceId, personId)
    .run();
}

/** How the register stands, for the heading. */
export function registerTally(rows: RegisterRow[]): { present: number; absent: number; excused: number; unmarked: number } {
  const tally = { present: 0, absent: 0, excused: 0, unmarked: 0 };
  for (const row of rows) {
    if (row.status === "present") tally.present++;
    else if (row.status === "absent") tally.absent++;
    else if (row.status === "excused") tally.excused++;
    else tally.unmarked++;
  }
  return tally;
}
