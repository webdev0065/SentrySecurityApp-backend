export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('notifications', {
    id: 'id',
    type: { type: 'varchar(100)', notNull: true },
    title: { type: 'varchar(255)', notNull: true },
    message: { type: 'text', notNull: true },
    reference_type: { type: 'varchar(100)' },
    reference_id: { type: 'integer' },
    target_role: { type: 'varchar(50)', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'unread' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createIndex('notifications', ['target_role', 'status', 'created_at']);
};

export const down = (pgm) => {
  pgm.dropTable('notifications');
};
