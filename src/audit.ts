/**
 * The audit log: who changed what, and when.
 *
 * Six people hold a Librarian policy in Cloudflare Access. When a piece's
 * composer changes, "who decided that?" is a reasonable question, and the only
 * honest answer comes from having written it down at the time.
 *
 * **Where the identity comes from.** Cloudflare Access authenticates the caller
 * at the edge and stamps `Cf-Access-Authenticated-User-Email` on the request.
 * That header is trusted **only on `/admin/*`**, where Access has demonstrably
 * run; anywhere else it is a string an attacker can set, and it is ignored.
 * `adminIdentity` in `src/auth.ts` is the single reader of it.
 *
 * **What never goes in here.** Not a password, not a hash of one, and nothing
 * about a chorister's attendance. The audit log is read by admins looking for
 * a mistake, and a register is personal data about a child; the two do not
 * belong in the same table. Attendance rows carry their own `marked_by`.
 */

/** One line of the log, as the activity page reads it. */
export interface AuditRow {
  id: number;
  at: string;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  detail: string | null;
}

/**
 * Record one admin mutation.
 *
 * Deliberately swallows its own failures. An audit write that throws would turn
 * a successful edit into a 500 and lose the edit as well as the record, which
 * is strictly worse than a missing line. The failure goes to the Worker log.
 */
export async function audit(
  db: D1Database,
  entry: {
    userEmail: string;
    action: string;
    entity?: string | null;
    entityId?: number | null;
    detail?: string | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (user_email, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(entry.userEmail, entry.action, entry.entity ?? null, entry.entityId ?? null, entry.detail ?? null)
      .run();
  } catch (e) {
    console.error("audit write failed", entry.action, e);
  }
}

/** The most recent actions, newest first, for the activity page. */
export async function recentActivity(db: D1Database, limit = 200): Promise<AuditRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?`)
    .bind(Math.min(Math.max(limit, 1), 500))
    .all<AuditRow>();
  return rows.results ?? [];
}
