export const shorthands = undefined;

/**
 * Agency Payroll Management.
 *
 * Two additive tables (no existing table is altered or recreated):
 *  - `payroll_records`: one row per guard per payroll month, storing the
 *    persisted salary components, the server-calculated net salary and the
 *    workflow status (pending | verified | paid).
 *  - `salary_advances`: money paid to a guard ahead of salary, tracked with a
 *    recovered_amount so an advance is recovered exactly once from payroll.
 *
 * Net salary rule (documented, backend-authoritative):
 *   gross = basic_salary + overtime + allowances
 *   net   = gross - deductions - advance_recovery
 */
export const up = pgm => {
  pgm.createTable('payroll_records', {
    id: 'id',
    agency_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    guard_id: {
      type: 'integer',
      notNull: true,
      references: 'guards',
      onDelete: 'CASCADE',
    },
    /** First day of the payroll month (YYYY-MM-01). Period boundary. */
    period: { type: 'date', notNull: true },
    basic_salary: { type: 'numeric(12,2)', notNull: true, default: 0 },
    overtime: { type: 'numeric(12,2)', notNull: true, default: 0 },
    allowances: { type: 'numeric(12,2)', notNull: true, default: 0 },
    deductions: { type: 'numeric(12,2)', notNull: true, default: 0 },
    /** Outstanding advance balance recovered from THIS payroll run. */
    advance_recovery: { type: 'numeric(12,2)', notNull: true, default: 0 },
    net_salary: { type: 'numeric(12,2)', notNull: true, default: 0 },
    status: { type: 'varchar(20)', notNull: true, default: 'pending' },
    verified_at: { type: 'timestamp' },
    paid_at: { type: 'timestamp' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // A single payroll record per guard per period (business rule).
  pgm.addConstraint('payroll_records', 'payroll_records_unique', {
    unique: ['agency_id', 'guard_id', 'period'],
  });
  pgm.createIndex('payroll_records', ['agency_id', 'period']);

  pgm.createTable('salary_advances', {
    id: 'id',
    agency_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    guard_id: {
      type: 'integer',
      notNull: true,
      references: 'guards',
      onDelete: 'CASCADE',
    },
    amount: { type: 'numeric(12,2)', notNull: true },
    recovered_amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
    reason: { type: 'varchar(255)' },
    status: { type: 'varchar(20)', notNull: true, default: 'outstanding' },
    recorded_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    recovered_at: { type: 'timestamp' },
  });
  pgm.createIndex('salary_advances', ['agency_id', 'guard_id', 'status']);
};

export const down = pgm => {
  pgm.dropTable('salary_advances');
  pgm.dropTable('payroll_records');
};
