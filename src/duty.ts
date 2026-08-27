/**
 * The safeguarding rota.
 *
 * Three duties per event — robing, general, dismissal — each with a backup,
 * and a coverage check that says plainly what is missing rather than making
 * somebody read a grid and work it out. Practices carry duties too, which is
 * why a manually created event is a first-class thing here rather than a
 * workaround.
 *
 * **The coverage rules are pure and live above `dutiesFor`.** Not for the sake
 * of testability alone: a rota that says green when it should say red is worse
 * than no rota at all, because somebody will trust it. Every rule below can be
 * put a case to without a database.
 *
 * What the rules are, and why each is the colour it is:
 *
 *   - **No robing or no dismissal cover — red.** These are the two moments
 *     children are unsupervised if nobody is there. General cover missing is
 *     amber: it is a gap, not an absence at the door.
 *   - **A DBS check that has run out — red.** A date in the past is a fact.
 *   - **A DBS check with no date at all — amber.** It means we do not know,
 *     which is not the same as knowing it has expired, and treating the two
 *     alike would train people to ignore the red ones.
 *   - **Boys and girls both due, and cover we know of is all one gender —
 *     amber.** Genders are recorded for duty adults only and often not at all,
 *     so this check degrades to silence rather than to a false alarm.
 *   - **Too many children per adult — amber, and only when somebody has set a
 *     figure.** The app does not ship a ratio: what is acceptable is the
 *     Minster's safeguarding policy to state, not this file's to invent.
 *
 * Personal data: duty rows name adults, and the on-the-day view names the
 * children a register covers. Nothing here goes in a log or an analytics event.
 * The one thing that reaches the choir side is a duty-holder's name on a
 * service page, which is A7's single stated exception.
 */

import type { PersonRow } from "./people";

export const DUTY_ROLES = [
  { value: "robing", label: "Robing", blurb: "In the song school before the service." },
  { value: "general", label: "General", blurb: "Around the children through the service." },
  { value: "dismissal", label: "Dismissal", blurb: "At the door afterwards, until every child has gone." },
] as const;

export type DutyRole = (typeof DUTY_ROLES)[number]["value"];

export function isDutyRole(value: string): value is DutyRole {
  return DUTY_ROLES.some((r) => r.value === value);
}

export const EVENT_TYPES = [
  { value: "regular", label: "Regular service" },
  { value: "wedding", label: "Wedding" },
  { value: "concert", label: "Concert" },
  { value: "tour", label: "Tour" },
  { value: "other", label: "Practice or other" },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]["value"];

export function isEventType(value: string): value is EventType {
  return EVENT_TYPES.some((t) => t.value === value);
}

/** One assignment, with enough of the person to run the checks on. */
export interface DutyRow {
  id: number;
  service_id: number;
  person_id: number;
  role: string;
  is_backup: number;
  note: string | null;
  all_collected_at: string | null;
  all_collected_by: string | null;
  display_name: string;
  gender: string | null;
  dbs_valid_until: string | null;
}

// ---------------------------------------------------------------------------
// Coverage — pure
// ---------------------------------------------------------------------------

export type Rag = "green" | "amber" | "red";

export interface CoverageIssue {
  severity: "amber" | "red";
  message: string;
}

export interface DutyCoverage {
  rag: Rag;
  issues: CoverageIssue[];
}

/** What the coverage check is given about one event. */
export interface CoverageInput {
  duties: readonly DutyRow[];
  /** The service designation, so we know whether both boys and girls are due. */
  designation: string | null;
  /** Expected under-16 headcount, or null when nobody knows. */
  childrenExpected: number | null;
  /** Children per adult the Minster's policy allows, or null when unset. */
  childrenPerAdult: number | null;
  /** Today, "YYYY-MM-DD". A DBS date is compared against this and nothing else. */
  today: string;
}

/**
 * Is this event covered?
 *
 * Returns every issue, not just the worst one, because the person reading it
 * has to fix all of them and a screen that reveals one problem at a time
 * wastes a Thursday evening.
 */
export function dutyCoverage(input: CoverageInput): DutyCoverage {
  const issues: CoverageIssue[] = [];

  // Primary cover only. A backup is a second name, not the cover itself: an
  // event with only a backup on the door has nobody on the door.
  const primary = input.duties.filter((d) => !d.is_backup);
  const held = (role: DutyRole) => primary.filter((d) => d.role === role);

  if (!held("robing").length) {
    issues.push({ severity: "red", message: "Nobody is on robing." });
  }
  if (!held("dismissal").length) {
    issues.push({ severity: "red", message: "Nobody is on dismissal." });
  }
  if (!held("general").length) {
    issues.push({ severity: "amber", message: "Nobody is on general duty." });
  }

  // DBS. Named individually, because "somebody's DBS has expired" is not a
  // thing anybody can act on.
  for (const duty of input.duties) {
    if (duty.dbs_valid_until === null) {
      issues.push({
        severity: "amber",
        message: `No DBS date recorded for ${duty.display_name}.`,
      });
    } else if (duty.dbs_valid_until < input.today) {
      issues.push({
        severity: "red",
        message: `${duty.display_name}'s DBS check ran out on ${duty.dbs_valid_until}.`,
      });
    }
  }

  // Both genders, when both the boys and the girls are due. Only ever amber:
  // gender is recorded for duty adults and often not recorded at all, and a
  // check that shouts on missing data trains people to ignore it.
  const designation = (input.designation ?? "").toLowerCase();
  const bothDue = designation.includes("boys") && designation.includes("girls");
  if (bothDue && primary.length) {
    const known = new Set(primary.map((d) => d.gender).filter((g): g is string => g !== null));
    if (known.size && !(known.has("m") && known.has("f"))) {
      issues.push({
        severity: "amber",
        message: "The boys and the girls are both due, and everybody on duty whose gender we hold is the same one.",
      });
    }
  }

  // Ratio. Silent unless somebody has set a figure — see the note at the top.
  if (input.childrenPerAdult !== null && input.childrenExpected !== null && primary.length) {
    const allowed = input.childrenPerAdult * primary.length;
    if (input.childrenExpected > allowed) {
      issues.push({
        severity: "amber",
        message: `About ${input.childrenExpected} children expected and ${primary.length} on duty — the figure set here allows ${allowed}.`,
      });
    }
  }

  const rag: Rag = issues.some((i) => i.severity === "red")
    ? "red"
    : issues.length
      ? "amber"
      : "green";

  return { rag, issues };
}

/**
 * Who may be put on a duty.
 *
 * Adults only, and never a leaver. A person with no school year is an adult —
 * that is what a null school year means, and it is the only age-shaped fact the
 * app holds.
 */
export function dutyCandidates(people: readonly PersonRow[]): PersonRow[] {
  return people.filter((p) => p.school_year === null && p.left_on === null && p.active === 1);
}

// ---------------------------------------------------------------------------
// Reading and writing duties
// ---------------------------------------------------------------------------

export async function dutiesFor(db: D1Database, serviceId: number): Promise<DutyRow[]> {
  const rows = await db
    .prepare(
      `SELECT d.id, d.service_id, d.person_id, d.role, d.is_backup, d.note,
              d.all_collected_at, d.all_collected_by,
              p.display_name, p.gender, p.dbs_valid_until
         FROM duty d
         JOIN person p ON p.id = d.person_id
        WHERE d.service_id = ?
        ORDER BY d.role, d.is_backup, p.display_name`
    )
    .bind(serviceId)
    .all<DutyRow>();
  return rows.results ?? [];
}

/** Every duty across a set of services, in one round trip, keyed by service. */
export async function dutiesForServices(
  db: D1Database,
  serviceIds: readonly number[]
): Promise<Map<number, DutyRow[]>> {
  const byService = new Map<number, DutyRow[]>();
  if (!serviceIds.length) return byService;

  const placeholders = serviceIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT d.id, d.service_id, d.person_id, d.role, d.is_backup, d.note,
              d.all_collected_at, d.all_collected_by,
              p.display_name, p.gender, p.dbs_valid_until
         FROM duty d
         JOIN person p ON p.id = d.person_id
        WHERE d.service_id IN (${placeholders})
        ORDER BY d.role, d.is_backup, p.display_name`
    )
    .bind(...serviceIds)
    .all<DutyRow>();

  for (const row of rows.results ?? []) {
    const list = byService.get(row.service_id);
    if (list) list.push(row);
    else byService.set(row.service_id, [row]);
  }
  return byService;
}

export async function assignDuty(
  db: D1Database,
  serviceId: number,
  personId: number,
  role: DutyRole,
  isBackup: boolean
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO duty (service_id, person_id, role, is_backup) VALUES (?, ?, ?, ?)`
    )
    .bind(serviceId, personId, role, isBackup ? 1 : 0)
    .run();
}

export async function removeDuty(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM duty WHERE id = ?`).bind(id).run();
}

/**
 * The Thursday rule: every child under eighteen has been collected.
 *
 * Ticked by whoever is on dismissal duty, against their own duty row, and
 * stamped with the time and their name. It is not a checkbox that can be
 * un-ticked: "I said they had all gone and then took it back" is not a state
 * the record should be able to hold. A mistake is a conversation, not a form.
 */
export async function markAllCollected(db: D1Database, dutyId: number, by: string): Promise<void> {
  await db
    .prepare(
      `UPDATE duty
          SET all_collected_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), all_collected_by = ?
        WHERE id = ? AND role = 'dismissal' AND all_collected_at IS NULL`
    )
    .bind(by, dutyId)
    .run();
}

/**
 * Create an event by hand.
 *
 * Weddings, concerts, tours and practices are not on the bmserviceapp feed and
 * never will be — it publishes the Minster's music list, not the music
 * department's diary. `source` is 'manual' so the feed's upsert leaves them
 * alone, and `feed_ref` stays null so nothing tries to match one.
 */
export async function createManualEvent(
  db: D1Database,
  event: {
    date: string;
    time: string | null;
    title: string;
    designation: string | null;
    eventType: EventType;
  }
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO service (service_date, service_time, title, designation, source, event_type)
       VALUES (?, ?, ?, ?, 'manual', ?) RETURNING id`
    )
    .bind(event.date, event.time, event.title.trim(), event.designation, event.eventType)
    .first<{ id: number }>();
  if (!row) throw new Error("That event could not be saved.");
  return row.id;
}
