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
 *   - A person who leaves gets a `left_on` date rather than a deletion, so past
 *     registers still read while they drop out of every current one.
 *
 * Addendum A extends this with what the department's workbook holds: a school
 * year, the joining and award dates, a DBS expiry for adults who take duties,
 * and — in its own table, behind its own gate — a parent's telephone number.
 * The one line worth reading twice is at `revealContacts`.
 *
 * **A school year and never a date of birth.** We are given one and not the
 * other, and an app that cannot compute an age cannot leak one. Three ways out
 * of a record exist and they are not the same thing: leaving (reversible),
 * anonymising (the counts survive, the name does not), and deleting (a parent
 * asking for their child's record to be removed is entitled to a real delete).
 */

import { CHURCH } from "./church.config";

export interface PersonRow {
  id: number;
  display_name: string;
  choir: string;
  voice_part: string | null;
  active: number;
  /**
   * The school year a child is in, or null for an adult.
   *
   * **A school year and never a date of birth.** It is the least that lets a
   * register be run sensibly and grouped the way the department thinks, and it
   * is deliberately not enough to compute an age from — the app is not given
   * the means, so it cannot leak one.
   */
  school_year: number | null;
  /** "YYYY-MM-DD", or null for "has not happened". */
  joined_on: string | null;
  surplice_awarded_on: string | null;
  deans_award_on: string | null;
  archbishops_award_on: string | null;
  gold_award_on: string | null;
  /** Adults who take safeguarding duties. Null for everybody else. */
  dbs_valid_until: string | null;
  /** Duty adults only, for the rota's both-genders check. Null for children. */
  gender: string | null;
  /** Set when somebody leaves. Excludes them from registers and pickers. */
  left_on: string | null;
}

export interface RegisterRow extends PersonRow {
  /** 'present' | 'absent' | 'excused', or null when not yet marked. */
  status: string | null;
  marked_by: string | null;
}

/** Choirs a person can belong to. Mirrors the CHECK in migration 0003. */
export const CHOIRS = [
  { value: "boys", label: "Boys" },
  { value: "girls", label: "Girls" },
  { value: "consort", label: "Consort" },
  { value: "satb", label: "SATB" },
  { value: "jc", label: "Junior choir" },
] as const;

export function isChoir(value: string): boolean {
  return CHOIRS.some((c) => c.value === value);
}

export function isVoicePart(value: string): boolean {
  return CHURCH.voiceParts.some((v) => v.value === value);
}

/** Every column of `person`, named once so no query invents its own list. */
const PERSON_COLUMNS = `id, display_name, choir, voice_part, active, school_year,
  joined_on, surplice_awarded_on, deans_award_on, archbishops_award_on, gold_award_on,
  dbs_valid_until, gender, left_on`;

/**
 * Reception to Year 13.
 *
 * Reception is 0 so that the September rollover is `school_year + 1` and needs
 * no special case. 14 would be past Year 13 and is where the rollover stops.
 */
export const SCHOOL_YEARS = Array.from({ length: 14 }, (_, i) => i);

export function schoolYearLabel(year: number | null): string {
  if (year === null) return "Adult";
  if (year <= 0) return "Reception";
  return `Year ${year}`;
}

/**
 * Everybody currently in a choir.
 *
 * Leavers are gone from this by default — `left_on` set means they are off the
 * registers and out of every picker, which is the rule in A7. `includeLeavers`
 * exists for the one screen that has to show them: the choir list itself,
 * where somebody marked as having left by mistake has to be findable again.
 */
export async function listPeople(db: D1Database, includeLeavers = false): Promise<PersonRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${PERSON_COLUMNS} FROM person
        ${includeLeavers ? "" : "WHERE active = 1 AND left_on IS NULL"}
        ORDER BY choir, display_name`
    )
    .all<PersonRow>();
  return rows.results ?? [];
}

export async function getPerson(db: D1Database, id: number): Promise<PersonRow | null> {
  return (
    (await db.prepare(`SELECT ${PERSON_COLUMNS} FROM person WHERE id = ?`).bind(id).first<PersonRow>()) ??
    null
  );
}

export async function addPerson(
  db: D1Database,
  person: {
    displayName: string;
    choir: string;
    voicePart: string | null;
    schoolYear?: number | null;
  }
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO person (display_name, choir, voice_part, school_year)
       VALUES (?, ?, ?, ?) RETURNING id`
    )
    .bind(person.displayName.trim(), person.choir, person.voicePart, person.schoolYear ?? null)
    .first<{ id: number }>();
  if (!row) throw new Error("That person could not be saved.");
  return row.id;
}

/** The fields a person's own screen edits. Undefined leaves a column alone. */
export interface PersonEdit {
  displayName?: string;
  choir?: string;
  voicePart?: string | null;
  schoolYear?: number | null;
  joinedOn?: string | null;
  surpliceAwardedOn?: string | null;
  deansAwardOn?: string | null;
  archbishopsAwardOn?: string | null;
  goldAwardOn?: string | null;
  dbsValidUntil?: string | null;
  gender?: string | null;
}

const EDIT_COLUMNS: ReadonlyArray<readonly [keyof PersonEdit, string]> = [
  ["displayName", "display_name"],
  ["choir", "choir"],
  ["voicePart", "voice_part"],
  ["schoolYear", "school_year"],
  ["joinedOn", "joined_on"],
  ["surpliceAwardedOn", "surplice_awarded_on"],
  ["deansAwardOn", "deans_award_on"],
  ["archbishopsAwardOn", "archbishops_award_on"],
  ["goldAwardOn", "gold_award_on"],
  ["dbsValidUntil", "dbs_valid_until"],
  ["gender", "gender"],
];

export async function updatePerson(db: D1Database, id: number, edit: PersonEdit): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of EDIT_COLUMNS) {
    const value = edit[field];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(typeof value === "string" ? value.trim() || null : value);
  }
  if (!sets.length) return;

  await db
    .prepare(
      `UPDATE person SET ${sets.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ?`
    )
    .bind(...values, id)
    .run();
}

/**
 * Somebody has left, on a date.
 *
 * `left_on` is what takes them off registers and out of pickers; `active` moves
 * with it so nothing that still reads the old column is caught out. Their
 * attendance stays exactly where it was, because last quarter's pay was worked
 * out from it and a leaver does not change what happened.
 */
export async function markLeft(db: D1Database, id: number, on: string): Promise<void> {
  await db
    .prepare(
      `UPDATE person SET left_on = ?, active = 0,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ?`
    )
    .bind(on, id)
    .run();
}

/** Back on the list, for a leaving date entered by mistake. */
export async function markReturned(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(
      `UPDATE person SET left_on = NULL, active = 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ?`
    )
    .bind(id)
    .run();
}

/**
 * Replace a former chorister's name with "Former chorister #id".
 *
 * The middle course between keeping a child's name for ever and deleting the
 * record: the counts a past quarter's pay was worked out from survive, and the
 * name they were worked out about does not. Parent contacts go with the name —
 * there is nobody left for them to belong to.
 *
 * Not reversible, which is why the screen asks twice.
 */
export async function anonymisePerson(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM parent_contact WHERE person_id = ?`).bind(id),
    db
      .prepare(
        `UPDATE person
            SET display_name = 'Former chorister #' || id,
                voice_part = NULL, gender = NULL, dbs_valid_until = NULL,
                active = 0,
                left_on = COALESCE(left_on, strftime('%Y-%m-%d','now')),
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = ?`
      )
      .bind(id),
  ]);
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
// Parent contacts — the hard-gated table
// ---------------------------------------------------------------------------

/**
 * A parent's telephone number.
 *
 * **This is the most sensitive thing the app holds**, and the rules are not
 * conventions:
 *
 *   - never rendered in a list, a table or an export, except the one explicit
 *     contacts export, which is music staff only and separately audited;
 *   - revealed one person at a time by a deliberate action, which writes an
 *     audit row naming the viewer, the child and the time;
 *   - never in a log line, a feedback row, an error message or a URL.
 *
 * Kept in its own table rather than as columns on `person` precisely so that
 * every ordinary `SELECT` from `person` — every list, every picker, every
 * export — is safe by construction rather than by remembering.
 *
 * `revealContacts` is the **only** read in the app, and it takes the viewer's
 * identity because it will not run without writing down who asked.
 */
export interface ParentContact {
  id: number;
  person_id: number;
  label: string | null;
  name: string | null;
  phone: string | null;
}

/** How many contacts a child has — a count, never the numbers themselves. */
export async function contactCountFor(db: D1Database, personId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT count(*) AS n FROM parent_contact WHERE person_id = ?`)
    .bind(personId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Read one child's contacts, and write down that it happened.
 *
 * The audit line comes first. If the write fails the read does not happen —
 * an unrecorded look at a child's parent's telephone number is the one outcome
 * this function exists to prevent, and refusing is better than allowing it.
 *
 * The audit detail names the child by id, never by name: the activity log is
 * read by admins looking for a mistake and scrolls past in the open.
 */
export async function revealContacts(
  db: D1Database,
  personId: number,
  viewer: string
): Promise<ParentContact[]> {
  await db
    .prepare(
      `INSERT INTO audit_log (user_email, action, entity, entity_id, detail)
       VALUES (?, 'contact.reveal', 'person', ?, 'parent contact details shown')`
    )
    .bind(viewer, personId)
    .run();

  const rows = await db
    .prepare(`SELECT id, person_id, label, name, phone FROM parent_contact WHERE person_id = ? ORDER BY id`)
    .bind(personId)
    .all<ParentContact>();
  return rows.results ?? [];
}

export async function addContact(
  db: D1Database,
  personId: number,
  contact: { label: string | null; name: string | null; phone: string | null }
): Promise<void> {
  await db
    .prepare(`INSERT INTO parent_contact (person_id, label, name, phone) VALUES (?, ?, ?, ?)`)
    .bind(personId, contact.label, contact.name, contact.phone)
    .run();
}

export async function deleteContact(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM parent_contact WHERE id = ?`).bind(id).run();
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
 *
 * The junior choir is never in that "everybody". They do not sing services from
 * music, they have their own register, and a five-year-old's name has no reason
 * to be on a phone at the door of Choral Evensong. A designation has to name
 * them outright to get them.
 */
const SERVICE_CHOIRS = CHOIRS.filter((c) => c.value !== "jc");

export function choirsExpectedFor(designation: string | null): string[] {
  const text = (designation ?? "").toLowerCase();
  const expected = CHOIRS.filter((c) => text.includes(c.value)).map((c) => c.value);
  return expected.length ? expected : SERVICE_CHOIRS.map((c) => c.value);
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
      `SELECT p.id, p.display_name, p.choir, p.voice_part, p.active, p.school_year,
              p.joined_on, p.surplice_awarded_on, p.deans_award_on, p.archbishops_award_on,
              p.gold_award_on, p.dbs_valid_until, p.gender, p.left_on,
              a.status, a.marked_by
         FROM person p
         LEFT JOIN attendance a ON a.person_id = p.id AND a.service_id = ?
        WHERE p.active = 1 AND p.left_on IS NULL AND p.choir IN (${placeholders})
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
