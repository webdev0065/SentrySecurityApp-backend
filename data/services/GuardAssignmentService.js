/**
 * Machine-readable business errors for guard assignment rules. Routes map these
 * straight to the existing `{ success:false, message, code }` error contract.
 */
class AssignmentError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = 'AssignmentError';
    this.code = code;
    this.status = status;
  }
}

function notFound(code, message) {
  return new AssignmentError(code, message, 404);
}

function invalid(code, message) {
  return new AssignmentError(code, message, 400);
}

/**
 * Central authority for guard-site assignment rules:
 *
 *  1. A guard can hold at most one active site (enforced structurally by the
 *     single `guards.site_id` column, re-checked here for clear API errors).
 *  2. The same guard cannot be assigned to the same site twice.
 *  3. A site cannot exceed its capacity (`coverage_requests.guards_needed`
 *     reached through `sites.source_coverage_request_id`).
 *  4. Assignments are never moved automatically - a guard must be unassigned
 *     before being assigned to a different site.
 *  5. Historical (ended / NULL site_id) assignments never block new ones.
 *
 * Concurrency: every mutating method expects to run inside a caller-owned
 * transaction and acquires row locks in one global order (guard rows by id
 * ASC, then the target site row FOR UPDATE) so concurrent assignment attempts
 * for the same guard or the same site serialize and re-check their rules
 * against committed state. The `enforce-guard-assignment-integrity` migration
 * adds a trigger that re-verifies capacity at the database level as a
 * final backstop.
 *
 * All methods take an execution `db` handle (a pooled client during BEGIN/COMMIT
 * or the pool for standalone reads) so callers keep full transaction control.
 */
class GuardAssignmentService {
  /** Deterministic lock order for a set of guard ids. */
  static normalizeGuardIds(guardIds) {
    const unique = [...new Set((guardIds || []).map(Number))].filter(
      Number.isInteger,
    );
    unique.sort((a, b) => a - b);
    return unique;
  }

  /**
   * Locks the target site row FOR UPDATE and returns it with its capacity.
   * Must be called after guard row locks (global lock order).
   */
  static async lockSite(db, siteId, agencyId) {
    const result = await db.query(
      `SELECT s.*, cr.guards_needed AS guard_capacity
       FROM sites s
       LEFT JOIN coverage_requests cr ON cr.id = s.source_coverage_request_id
       WHERE s.id = $1 AND s.agency_id = $2
       FOR UPDATE OF s`,
      [siteId, agencyId],
    );
    if (!result.rows[0]) {
      throw notFound('SITE_NOT_FOUND', 'Site not found');
    }
    return result.rows[0];
  }

  /**
   * Locks the given guard rows FOR UPDATE (id ASC) scoped to the agency and
   * returns them. Throws when any guard is missing or belongs to another
   * agency, so the count taken under lock is authoritative.
   */
  static async lockGuards(db, agencyId, guardIds) {
    const ids = this.normalizeGuardIds(guardIds);
    if (!ids.length) {
      throw invalid('NO_GUARDS_SELECTED', 'Select at least one guard');
    }
    const result = await db.query(
      `SELECT id, user_id, agency_id, site_id
       FROM guards
       WHERE agency_id = $1 AND id = ANY($2::int[])
       ORDER BY id ASC
       FOR UPDATE`,
      [agencyId, ids],
    );
    if (result.rows.length !== ids.length) {
      throw invalid(
        'GUARDS_NOT_FOUND',
        'One or more selected guards are unavailable',
      );
    }
    return result.rows;
  }

  /**
   * Counts the guards currently occupying a site. Must run after the site row
   * lock so the count reflects every committed assignment.
   */
  static async countActiveGuards(db, siteId) {
    const result = await db.query(
      'SELECT COUNT(*)::int AS count FROM guards WHERE site_id = $1',
      [siteId],
    );
    return result.rows[0].count;
  }

  static assertCapacity(site, activeCount, incomingCount) {
    const capacity = site.guard_capacity;
    if (capacity === null || capacity === undefined) return; // no linked request = unlimited
    if (activeCount + incomingCount > capacity) {
      throw new AssignmentError(
        'SITE_CAPACITY_REACHED',
        `Site capacity reached: this site supports up to ${capacity} guard${
          capacity === 1 ? '' : 's'
        }.`,
      );
    }
  }


  /**
   * Validates and performs the assignment for guards that already exist.
   * Caller must have begun a transaction; this locks guards then site,
   * re-checks every rule against locked state, then writes site_id.
   */
  static async assign(db, { agencyId, siteId, guardIds }) {
    const ids = this.normalizeGuardIds(guardIds);
    const guards = await this.lockGuards(db, agencyId, ids);
    const site = await this.lockSite(db, siteId, agencyId);

    for (const guard of guards) {
      if (guard.site_id === site.id) {
        throw new AssignmentError(
          'DUPLICATE_ASSIGNMENT',
          'This guard is already assigned to this site.',
        );
      }
      if (guard.site_id !== null) {
        throw new AssignmentError(
          'GUARD_ALREADY_ASSIGNED',
          'This guard is already assigned to another active site. End that assignment first.',
        );
      }
    }

    const activeCount = await this.countActiveGuards(db, site.id);
    this.assertCapacity(site, activeCount, guards.length);

    await db.query(
      'UPDATE guards SET site_id = $1 WHERE agency_id = $2 AND id = ANY($3::int[])',
      [site.id, agencyId, ids],
    );
    return { site, assignedGuardIds: ids };
  }

  /**
   * Validates the assignment target for a brand-new guard (no guard row to
   * lock yet): locks the site, then checks capacity for one additional guard.
   */
  static async prepareCreate(db, { agencyId, siteId }) {
    const site = await this.lockSite(db, siteId, agencyId);
    const activeCount = await this.countActiveGuards(db, site.id);
    this.assertCapacity(site, activeCount, 1);
    return site;
  }

  /**
   * Validates a site change for an existing guard whose row is already locked
   * FOR UPDATE by the caller. Returns the site_id to persist:
   *   - same site            -> unchanged (idempotent, no double assignment)
   *   - unassigned -> site   -> capacity check, then assign
   *   - assigned  -> null    -> explicit unassign, frees a slot
   *   - assigned  -> other   -> rejected (never auto-move)
   */
  static async prepareSiteChange(db, { agencyId, currentSiteId, targetSiteId }) {
    if (targetSiteId === currentSiteId) return currentSiteId;

    if (currentSiteId !== null && currentSiteId !== undefined) {
      if (targetSiteId === null) return null; // explicit unassign
      throw new AssignmentError(
        'GUARD_ALREADY_ASSIGNED',
        'This guard is already assigned to another active site. End that assignment first.',
      );
    }

    if (targetSiteId === null) return null; // already unassigned

    const site = await this.lockSite(db, targetSiteId, agencyId);
    const activeCount = await this.countActiveGuards(db, site.id);
    this.assertCapacity(site, activeCount, 1);
    return site.id;
  }

  /**
   * Maps the migration trigger's `SITE_CAPACITY_REACHED` backstop failure to
   * the shared business error so routes still return the standard contract.
   */
  static normalizeError(err) {
    if (err instanceof AssignmentError) return err;
    if (
      err &&
      typeof err.message === 'string' &&
      err.message.includes('SITE_CAPACITY_REACHED')
    ) {
      const capacity = err.message.match(/capacity (\d+)/);
      return new AssignmentError(
        'SITE_CAPACITY_REACHED',
        `Site capacity reached: this site supports up to ${
          capacity ? capacity[1] : '?'
        } guard${capacity && capacity[1] === '1' ? '' : 's'}.`,
      );
    }
    return err;
  }
}

GuardAssignmentService.AssignmentError = AssignmentError;

module.exports = GuardAssignmentService;
