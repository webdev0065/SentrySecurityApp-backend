export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('guards', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, unique: true, references: 'users', onDelete: 'CASCADE' },
    agency_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    site_id: { type: 'integer', references: 'sites', onDelete: 'SET NULL' }, 
    coverage_plan: { type: 'varchar(20)', notNull: true, default: 'day_shift' },
    start_time: { type: 'time' },
    end_time: { type: 'time' },
    basic_salary: { type: 'numeric(10,2)' },
    allowances: { type: 'numeric(10,2)', default: 0 },
    status: { type: 'varchar(20)', notNull: true, default: 'off_duty' }, 
    current_latitude: { type: 'decimal(10,7)' },
    current_longitude: { type: 'decimal(10,7)' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });
};

export const down = (pgm) => {
  pgm.dropTable('guards');
};