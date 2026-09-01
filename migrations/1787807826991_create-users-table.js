export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('users', {
    id: 'id',
    full_name: { type: 'varchar(255)', notNull: true },
    mobile_number: { type: 'varchar(20)', notNull: true, unique: true },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password: { type: 'text', notNull: true },
    account_type: { type: 'varchar(20)', notNull: true },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') }
  });
};

export const down = (pgm) => {
  pgm.dropTable('users');
};
