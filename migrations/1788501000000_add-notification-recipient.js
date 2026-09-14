export const shorthands = undefined;

export const up = pgm => {
  pgm.addColumns('notifications', {
    recipient_id: { type: 'integer' },
    recipient_type: { type: 'varchar(50)' },
  });

  pgm.createIndex('notifications', [
    'target_role',
    'recipient_id',
    'status',
    'created_at',
  ]);
};

export const down = pgm => {
  pgm.dropIndex('notifications', [
    'target_role',
    'recipient_id',
    'status',
    'created_at',
  ]);
  pgm.dropColumns('notifications', ['recipient_id', 'recipient_type']);
};
