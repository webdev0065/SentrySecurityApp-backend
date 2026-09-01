export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('incident_images', {
    id: 'id',
    incident_id: { type: 'integer', notNull: true, references: 'incidents', onDelete: 'CASCADE' },
    image_url: { type: 'text', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });
};

export const down = (pgm) => {
  pgm.dropTable('incident_images');
};