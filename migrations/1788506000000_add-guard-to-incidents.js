export const shorthands = undefined;

export const up = pgm => {
  pgm.addColumn('incidents', {
    guard_id: {
      type: 'integer',
      references: 'guards',
      onDelete: 'SET NULL',
    },
  });
  pgm.createIndex('incidents', 'guard_id');
};

export const down = pgm => {
  pgm.dropIndex('incidents', 'guard_id');
  pgm.dropColumn('incidents', 'guard_id');
};
