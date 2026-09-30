export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('coverage_request_checkpoints', {
    id: 'id',
    coverage_request_id: {
      type: 'integer',
      notNull: true,
      references: 'coverage_requests',
      onDelete: 'CASCADE',
    },
    name: { type: 'varchar(255)', notNull: true },
    sequence_order: { type: 'integer', notNull: true, default: 1 },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('coverage_request_checkpoints', 'coverage_request_id');
};

export const down = (pgm) => {
  pgm.dropTable('coverage_request_checkpoints');
};
