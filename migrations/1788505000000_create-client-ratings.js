export const shorthands = undefined;

export const up = pgm => {
  pgm.createTable('client_ratings', {
    id: 'id',
    client_id: {
      type: 'integer',
      notNull: true,
      references: 'clients',
      onDelete: 'CASCADE',
    },
    agency_id: {
      type: 'integer',
      notNull: true,
      references: 'agencies',
      onDelete: 'CASCADE',
    },
    guard_id: {
      type: 'integer',
      references: 'guards',
      onDelete: 'CASCADE',
    },
    rating: { type: 'integer', notNull: true },
    comment: { type: 'text' },
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
  pgm.addConstraint(
    'client_ratings',
    'client_ratings_rating_range',
    'CHECK (rating BETWEEN 1 AND 5)',
  );
  pgm.sql(`
    CREATE UNIQUE INDEX client_ratings_agency_unique
      ON client_ratings (client_id, agency_id)
      WHERE guard_id IS NULL;
    CREATE UNIQUE INDEX client_ratings_guard_unique
      ON client_ratings (client_id, guard_id)
      WHERE guard_id IS NOT NULL;
  `);
};

export const down = pgm => {
  pgm.dropTable('client_ratings');
};
