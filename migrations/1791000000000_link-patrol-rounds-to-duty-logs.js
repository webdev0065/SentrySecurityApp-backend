export const shorthands = undefined;

export const up = (pgm) => {
  // Links each patrol round to the duty session (duty_logs row) it belongs to,
  // so checkpoint completion is scoped to the guard's current duty session.
  // Idempotent: safe to run on databases that already have the column.
  pgm.sql(`
    ALTER TABLE patrol_rounds
      ADD COLUMN IF NOT EXISTS duty_log_id INTEGER REFERENCES duty_logs(id) ON DELETE SET NULL;
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS patrol_rounds_guard_duty_idx
      ON patrol_rounds (guard_id, duty_log_id);
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS patrol_rounds_duty_status_idx
      ON patrol_rounds (duty_log_id, status);
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS patrol_rounds_duty_status_idx;`);
  pgm.sql(`DROP INDEX IF EXISTS patrol_rounds_guard_duty_idx;`);
  pgm.sql(`ALTER TABLE patrol_rounds DROP COLUMN IF EXISTS duty_log_id;`);
};
