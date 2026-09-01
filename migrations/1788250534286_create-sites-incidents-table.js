export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('sites', {
    id: 'id',
    agency_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    site_name: { type: 'varchar(255)', notNull: true },
    site_address: { type: 'text' },
    city: { type: 'varchar(100)' },
    state: { type: 'varchar(100)' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.createTable('incidents', {
    id: 'id',
    agency_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    site_id: { type: 'integer', notNull: true, references: 'sites', onDelete: 'CASCADE' },
    severity: { type: 'varchar(10)', notNull: true },
    notes: { type: 'text', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'open' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });
};

export const down = (pgm) => {
  pgm.dropTable('incidents');
  pgm.dropTable('sites');
};