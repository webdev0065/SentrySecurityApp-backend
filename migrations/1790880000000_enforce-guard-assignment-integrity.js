export const shorthands = undefined;

// Enforces guard-site assignment integrity directly in PostgreSQL so that
// concurrent or out-of-band writes can never leave a site over capacity:
//
//  * partial index keeps active-assignment counts fast (history rows with
//    site_id IS NULL are excluded, so ended assignments never participate);
//  * BEFORE INSERT OR UPDATE trigger locks the site row and re-checks
//    coverage_requests.guards_needed before any site_id change commits.
//
// The unique index on guards(user_id) already guarantees a guard can hold at
// most one active site, so no additional constraint is needed for that rule.
// The audit in the task report confirmed no existing row violates capacity,
// therefore no data cleanup is required before applying this migration.

export const up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS guards_site_id_active_idx
      ON guards (site_id)
      WHERE site_id IS NOT NULL;
  `);

  pgm.sql(`
    CREATE FUNCTION enforce_site_guard_capacity() RETURNS trigger AS $$
    DECLARE
      target_site integer := NEW.site_id;
      capacity integer;
      occupants integer;
    BEGIN
      IF target_site IS NULL THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.site_id IS NOT DISTINCT FROM NEW.site_id THEN
        RETURN NEW;
      END IF;

      -- Serialize concurrent assignment changes for the same site. Callers
      -- normally hold this lock already (same transaction = re-entrant).
      PERFORM 1 FROM sites WHERE id = target_site FOR UPDATE;

      SELECT cr.guards_needed INTO capacity
      FROM sites s
      LEFT JOIN coverage_requests cr ON cr.id = s.source_coverage_request_id
      WHERE s.id = target_site;

      IF capacity IS NULL THEN
        RETURN NEW;
      END IF;

      -- NEW is never visible to this statement for the site being entered
      -- (it is a new row or still counted at its old site), so +1 below.
      SELECT COUNT(*) INTO occupants FROM guards WHERE site_id = target_site;

      IF occupants + 1 > capacity THEN
        RAISE EXCEPTION 'SITE_CAPACITY_REACHED: site % has capacity %', target_site, capacity
          USING ERRCODE = 'check_violation';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER trg_enforce_site_guard_capacity
      BEFORE INSERT OR UPDATE OF site_id ON guards
      FOR EACH ROW
      EXECUTE FUNCTION enforce_site_guard_capacity();
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS trg_enforce_site_guard_capacity ON guards;`);
  pgm.sql(`DROP FUNCTION IF EXISTS enforce_site_guard_capacity();`);
  pgm.sql(`DROP INDEX IF EXISTS guards_site_id_active_idx;`);
};
