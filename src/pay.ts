/**
 * Attendance totals, rates, and what the choristers are owed.
 *
 * The department pays choristers quarterly on how often they sang, at one rate
 * for services and another for weddings. That is arithmetic over the register,
 * and this file is all of it.
 *
 * **Money is pence, never pounds.** No floating point touches a figure anybody
 * is paid: `amount_pence` is an integer in the database, multiplication by a
 * count keeps it an integer, and the only division is by 100 when a number is
 * printed. A pay run that is a penny out because of binary fractions is a
 * conversation with a parent nobody should have to have.
 *
 * **A rate is a row with a date, not a figure that gets edited over.** Last
 * quarter's pay must still compute at last quarter's rate however many times
 * the rate has changed since, so the rate applied to a service is the one in
 * force on the day of that service — worked out per service, not per quarter.
 * A quarter that straddles a rate change comes out right without anybody having
 * to notice that it did.
 *
 * **Nothing is seeded.** The real figures are the music department's to set.
 * Inventing one would produce a plausible-looking pay run that is wrong, which
 * is worse than an empty screen saying no rate has been set.
 *
 * Everything above `attendanceLines` is pure.
 */

/** The two things a chorister is paid for. */
export const RATE_ROLES = [
  { value: "chorister_service", label: "Service", blurb: "Every service and practice they sang at." },
  { value: "chorister_wedding", label: "Wedding", blurb: "Weddings, which pay separately." },
] as const;

export type RateRole = (typeof RATE_ROLES)[number]["value"];

export function isRateRole(value: string): value is RateRole {
  return RATE_ROLES.some((r) => r.value === value);
}

export interface RateRow {
  id: number;
  role: string;
  amount_pence: number;
  effective_from: string;
  created_by: string | null;
}

/** One person at one event, as the pay run reads it. */
export interface AttendanceLine {
  person_id: number;
  display_name: string;
  choir: string;
  service_date: string;
  event_type: string;
}

// ---------------------------------------------------------------------------
// Quarters
// ---------------------------------------------------------------------------

export interface Quarter {
  /** "2026-Q3". */
  ref: string;
  year: number;
  /** 1–4. */
  quarter: number;
  /** Inclusive, "YYYY-MM-DD". */
  from: string;
  /** Inclusive, "YYYY-MM-DD". */
  to: string;
  label: string;
}

const QUARTER_MONTHS = [
  { from: "01-01", to: "03-31", label: "January to March" },
  { from: "04-01", to: "06-30", label: "April to June" },
  { from: "07-01", to: "09-30", label: "July to September" },
  { from: "10-01", to: "12-31", label: "October to December" },
] as const;

export function quarterOf(date: string): Quarter {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const quarter = Math.min(4, Math.max(1, Math.ceil(month / 3)));
  return quarterFor(year, quarter);
}

export function quarterFor(year: number, quarter: number): Quarter {
  const months = QUARTER_MONTHS[quarter - 1]!;
  return {
    ref: `${year}-Q${quarter}`,
    year,
    quarter,
    from: `${year}-${months.from}`,
    to: `${year}-${months.to}`,
    label: `${months.label} ${year}`,
  };
}

export function parseQuarterRef(ref: string): Quarter | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(ref);
  if (!match) return null;
  return quarterFor(Number(match[1]), Number(match[2]));
}

/** The quarter containing `today` and the ones before it, newest first. */
export function recentQuarters(today: string, count = 8): Quarter[] {
  const current = quarterOf(today);
  const quarters: Quarter[] = [];
  let { year, quarter } = current;
  for (let i = 0; i < count; i++) {
    quarters.push(quarterFor(year, quarter));
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }
  return quarters;
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/**
 * The rate in force for a role on a date, or null if none was.
 *
 * Null is a real answer and not an error: a service sung before anybody set a
 * rate has no rate, and the pay run says so on that line rather than quietly
 * treating it as nought. A missing rate that reads as £0.00 is a chorister
 * short-changed without anybody noticing.
 */
export function rateOn(rates: readonly RateRow[], role: string, date: string): RateRow | null {
  let best: RateRow | null = null;
  for (const rate of rates) {
    if (rate.role !== role) continue;
    if (rate.effective_from > date) continue;
    if (!best || rate.effective_from > best.effective_from) best = rate;
  }
  return best;
}

/** Which rate an event pays at. Everything that is not a wedding is a service. */
export function rateRoleFor(eventType: string): RateRole {
  return eventType === "wedding" ? "chorister_wedding" : "chorister_service";
}

// ---------------------------------------------------------------------------
// The pay run
// ---------------------------------------------------------------------------

export interface PayLine {
  person_id: number;
  display_name: string;
  choir: string;
  services: number;
  weddings: number;
  /** Attendances with no rate in force on the day. */
  unrated: number;
  pence: number;
}

export interface PayRun {
  quarter: Quarter;
  lines: PayLine[];
  totalPence: number;
  /** How many attendances fell on a day no rate covered. */
  unrated: number;
}

/**
 * Work out one quarter's pay.
 *
 * Per attendance, not per person: the rate is looked up on the date of each
 * service, so a quarter spanning a rate change is right without anybody having
 * to think about it. Lines come back in the order the pay run is read in —
 * choir, then name.
 */
export function payRun(
  quarter: Quarter,
  lines: readonly AttendanceLine[],
  rates: readonly RateRow[]
): PayRun {
  const byPerson = new Map<number, PayLine>();

  for (const line of lines) {
    let row = byPerson.get(line.person_id);
    if (!row) {
      row = {
        person_id: line.person_id,
        display_name: line.display_name,
        choir: line.choir,
        services: 0,
        weddings: 0,
        unrated: 0,
        pence: 0,
      };
      byPerson.set(line.person_id, row);
    }

    const role = rateRoleFor(line.event_type);
    if (role === "chorister_wedding") row.weddings += 1;
    else row.services += 1;

    const rate = rateOn(rates, role, line.service_date);
    if (rate) row.pence += rate.amount_pence;
    else row.unrated += 1;
  }

  const sorted = [...byPerson.values()].sort(
    (a, b) => a.choir.localeCompare(b.choir) || a.display_name.localeCompare(b.display_name)
  );

  return {
    quarter,
    lines: sorted,
    totalPence: sorted.reduce((sum, l) => sum + l.pence, 0),
    unrated: sorted.reduce((sum, l) => sum + l.unrated, 0),
  };
}

/** Pence as "£12.50". The only place a figure stops being an integer. */
export function pounds(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "£12.50" or "12.50" back to 1250, or null if it is not a figure. */
export function penceFrom(raw: string): number | null {
  const cleaned = raw.replace(/[£\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

// ---------------------------------------------------------------------------
// Monthly totals — the workbook's September / Quarter / % columns
// ---------------------------------------------------------------------------

export interface MonthTotal {
  /** "2026-09". */
  month: string;
  present: number;
  /** Events that person's choir was due at in that month. */
  possible: number;
}

export interface PersonTotals {
  person_id: number;
  display_name: string;
  choir: string;
  months: MonthTotal[];
  present: number;
  possible: number;
  /** 0–100, or null when the person's choir was due at nothing. */
  percent: number | null;
}

/**
 * Per person, per month, and as a percentage — the shape of the workbook.
 *
 * "Possible" is how many events that person's choir was actually due at, not
 * how many events there were: the boys are not marked down for missing an
 * Evensong the girls sang. A person due at nothing has a null percentage
 * rather than a zero, because 0% reads as "never turned up" and the truth is
 * "was never asked".
 */
export function totalsByPerson(
  lines: readonly AttendanceLine[],
  possibleByPersonMonth: ReadonlyMap<string, number>,
  people: ReadonlyArray<{ id: number; display_name: string; choir: string }>
): PersonTotals[] {
  const presentByPersonMonth = new Map<string, number>();
  for (const line of lines) {
    const key = `${line.person_id}:${line.service_date.slice(0, 7)}`;
    presentByPersonMonth.set(key, (presentByPersonMonth.get(key) ?? 0) + 1);
  }

  const months = [
    ...new Set([
      ...[...presentByPersonMonth.keys()].map((k) => k.split(":")[1]!),
      ...[...possibleByPersonMonth.keys()].map((k) => k.split(":")[1]!),
    ]),
  ].sort();

  return people.map((person) => {
    const rows = months.map((month) => ({
      month,
      present: presentByPersonMonth.get(`${person.id}:${month}`) ?? 0,
      possible: possibleByPersonMonth.get(`${person.id}:${month}`) ?? 0,
    }));
    const present = rows.reduce((s, r) => s + r.present, 0);
    const possible = rows.reduce((s, r) => s + r.possible, 0);
    return {
      person_id: person.id,
      display_name: person.display_name,
      choir: person.choir,
      months: rows,
      present,
      possible,
      percent: possible ? Math.round((present / possible) * 100) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Reading it out of D1
// ---------------------------------------------------------------------------

export async function listRates(db: D1Database): Promise<RateRow[]> {
  const rows = await db
    .prepare(`SELECT id, role, amount_pence, effective_from, created_by FROM rate ORDER BY role, effective_from DESC`)
    .all<RateRow>();
  return rows.results ?? [];
}

export async function addRate(
  db: D1Database,
  rate: { role: RateRole; amountPence: number; effectiveFrom: string; by: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rate (role, amount_pence, effective_from, created_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (role, effective_from) DO UPDATE SET
         amount_pence = excluded.amount_pence, created_by = excluded.created_by`
    )
    .bind(rate.role, rate.amountPence, rate.effectiveFrom, rate.by)
    .run();
}

export async function deleteRate(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM rate WHERE id = ?`).bind(id).run();
}

/**
 * Every attendance marked present between two dates.
 *
 * Leavers are included on purpose. Somebody who left in October is still owed
 * for the services they sang in September, and dropping them from the pay run
 * because they are off the current register would quietly short-change them.
 */
export async function attendanceLines(
  db: D1Database,
  from: string,
  to: string
): Promise<AttendanceLine[]> {
  const rows = await db
    .prepare(
      `SELECT a.person_id, p.display_name, p.choir,
              s.service_date, COALESCE(s.event_type, 'regular') AS event_type
         FROM attendance a
         JOIN person p ON p.id = a.person_id
         JOIN service s ON s.id = a.service_id
        WHERE a.status = 'present' AND s.service_date BETWEEN ? AND ?
        ORDER BY p.choir, p.display_name, s.service_date`
    )
    .bind(from, to)
    .all<AttendanceLine>();
  return rows.results ?? [];
}

/**
 * How many events each person's choir was due at, per month.
 *
 * Keyed `"<personId>:<YYYY-MM>"`. The designation matching is the same words
 * test the register uses, done in SQL so this is one round trip rather than one
 * per service: a person counts towards an event when the designation names
 * their choir, or names none of the four and therefore means everybody.
 */
export async function possibleByPersonMonth(
  db: D1Database,
  from: string,
  to: string
): Promise<Map<string, number>> {
  const rows = await db
    .prepare(
      `SELECT p.id AS person_id, substr(s.service_date, 1, 7) AS month, COUNT(*) AS n
         FROM service s
         JOIN person p
           ON (
                INSTR(LOWER(COALESCE(s.designation,'')), p.choir) > 0
                OR (
                     p.choir != 'jc'
                     AND INSTR(LOWER(COALESCE(s.designation,'')), 'boys') = 0
                     AND INSTR(LOWER(COALESCE(s.designation,'')), 'girls') = 0
                     AND INSTR(LOWER(COALESCE(s.designation,'')), 'consort') = 0
                     AND INSTR(LOWER(COALESCE(s.designation,'')), 'satb') = 0
                   )
              )
        WHERE s.service_date BETWEEN ? AND ?
        GROUP BY p.id, month`
    )
    .bind(from, to)
    .all<{ person_id: number; month: string; n: number }>();

  const map = new Map<string, number>();
  for (const row of rows.results ?? []) map.set(`${row.person_id}:${row.month}`, row.n);
  return map;
}
