export const shorthands = undefined;

export const up = pgm => {
  pgm.createTable('plans', {
    id: 'id',
    name: { type: 'varchar(50)', notNull: true, unique: true },
    price: { type: 'numeric(10,2)', notNull: true },
    max_guards: { type: 'integer' },
    max_sites: { type: 'integer' },
    features: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'[]'::jsonb"),
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createTable('agency_subscriptions', {
    id: 'id',
    agency_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    plan_id: {
      type: 'integer',
      notNull: true,
      references: 'plans',
      onDelete: 'RESTRICT',
    },
    status: { type: 'varchar(20)', notNull: true, default: 'active' },
    started_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    renews_at: { type: 'timestamp' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('agency_subscriptions', 'agency_id');
  pgm.createIndex('agency_subscriptions', 'plan_id');

  pgm.sql(`
    INSERT INTO plans (name, price, max_guards, max_sites, features) VALUES
    ('Basic', 4999, 5, 2, '["Attendance & clock-in tracking", "Basic shift scheduling", "Email support"]'::jsonb),
    ('Pro', 12999, 50, 15, '["Everything in Basic", "GPS patrol checkpoints", "Incident reporting & alerts", "Client portal access", "Priority support"]'::jsonb)
    ON CONFLICT (name) DO UPDATE SET
      price = EXCLUDED.price,
      max_guards = EXCLUDED.max_guards,
      max_sites = EXCLUDED.max_sites,
      features = EXCLUDED.features;
  `);

  // Backfill: every existing agency user gets an active Pro subscription
  // (guards/sites tables key agency_id -> users.id, so subscription uses users.id too).
  pgm.sql(`
    INSERT INTO agency_subscriptions (agency_id, plan_id, status, started_at, renews_at)
    SELECT u.id, p.id, 'active', NOW(), NOW() + INTERVAL '1 month'
    FROM users u
    CROSS JOIN (SELECT id FROM plans WHERE name = 'Pro' LIMIT 1) p
    WHERE u.account_type = 'agency'
    AND NOT EXISTS (
      SELECT 1 FROM agency_subscriptions s
      WHERE s.agency_id = u.id AND s.status = 'active'
    );
  `);
};

export const down = pgm => {
  pgm.dropTable('agency_subscriptions');
  pgm.dropTable('plans');
};
