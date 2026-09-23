export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('checkpoints', {
    id: 'id',
    site_id: { type: 'integer', notNull: true, references: 'sites', onDelete: 'CASCADE' },
    name: { type: 'varchar(255)', notNull: true },
    sequence_order: { type: 'integer', notNull: true, default: 1 },
    latitude: { type: 'decimal(10,7)' },
    longitude: { type: 'decimal(10,7)' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.createTable('patrol_rounds', {
    id: 'id',
    guard_id: { type: 'integer', notNull: true, references: 'guards', onDelete: 'CASCADE' },
    site_id: { type: 'integer', notNull: true, references: 'sites', onDelete: 'CASCADE' },
    agency_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    status: { type: 'varchar(20)', notNull: true, default: 'in_progress' },
    total_checkpoints: { type: 'integer', notNull: true },
    scanned_count: { type: 'integer', notNull: true, default: 0 },
    started_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
    completed_at: { type: 'timestamp' }
  });

  pgm.createTable('patrol_scans', {
    id: 'id',
    round_id: { type: 'integer', notNull: true, references: 'patrol_rounds', onDelete: 'CASCADE' },
    checkpoint_id: { type: 'integer', notNull: true, references: 'checkpoints', onDelete: 'CASCADE' },
    guard_id: { type: 'integer', notNull: true, references: 'guards', onDelete: 'CASCADE' },
    scanned_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.addConstraint('patrol_scans', 'patrol_scans_round_checkpoint_unique', {
    unique: ['round_id', 'checkpoint_id']
  });
};

export const down = (pgm) => {
  pgm.dropTable('patrol_scans');
  pgm.dropTable('patrol_rounds');
  pgm.dropTable('checkpoints');
};
