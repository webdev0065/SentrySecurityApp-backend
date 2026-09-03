export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('coverage_requests', {
    id: 'id',
    client_id: {
      type: 'integer',
      notNull: true,
      references: 'clients',
      onDelete: 'CASCADE',
    },
    event_name: { type: 'varchar(255)' },
    state: { type: 'varchar(100)', notNull: true },
    district: { type: 'varchar(100)', notNull: true },
    city: { type: 'varchar(100)', notNull: true },
    pincode: { type: 'varchar(6)', notNull: true },
    site_location: { type: 'varchar(255)', notNull: true },
    guards_needed: { type: 'integer', notNull: true, default: 1 },
    notes: { type: 'text' },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'pending',
    },
    assigned_agency_id: {
      type: 'integer',
      references: 'agencies',
      onDelete: 'SET NULL',
    },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addConstraint('coverage_requests', 'guards_needed_positive', 'CHECK (guards_needed > 0)');
  pgm.addConstraint(
    'coverage_requests',
    'status_check',
    "CHECK (status IN ('pending', 'approved', 'rejected', 'assigned', 'completed', 'cancelled'))"
  );

  pgm.createIndex('coverage_requests', 'client_id');
  pgm.createIndex('coverage_requests', 'status');
  pgm.createIndex('coverage_requests', 'assigned_agency_id');
};

export const down = (pgm) => {
  pgm.dropTable('coverage_requests');
};