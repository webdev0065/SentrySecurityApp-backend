/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('agencies', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, unique: true, references: 'users', onDelete: 'CASCADE' },
    agency_name: { type: 'varchar(255)', notNull: true },
    business_type: { type: 'varchar(100)', notNull: true },
    gst_number: { type: 'varchar(20)' },
    office_address: { type: 'text', notNull: true },
    city: { type: 'varchar(100)', notNull: true },
    state: { type: 'varchar(100)', notNull: true },
    pincode: { type: 'varchar(6)', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });

  pgm.createTable('clients', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, unique: true, references: 'users', onDelete: 'CASCADE' },
    company_name: { type: 'varchar(255)', notNull: true },
    site_name: { type: 'varchar(255)', notNull: true },
    site_address: { type: 'text', notNull: true },
    city: { type: 'varchar(100)', notNull: true },
    state: { type: 'varchar(100)', notNull: true },
    pincode: { type: 'varchar(6)', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('clients');
  pgm.dropTable('agencies');
};
