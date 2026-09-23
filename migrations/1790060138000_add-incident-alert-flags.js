export const shorthands = undefined;

/**
 * Guard-filed incident alert pipeline.
 *
 * incidents:
 *   acknowledged_at   - set the moment the agency opens/sees the incident; stops the buzzer.
 *   escalated_at      - set 15 minutes after reporting, when the incident is handed to client alerts.
 *   reminder_count    - how many 5-minute buzzer ticks have been sent.
 *   last_reminder_at  - timestamp of the most recent buzzer tick.
 *
 * notifications:
 *   sound_pending     - polled only by the agency app; consumed to play the buzzer burst.
 *
 * Every step is idempotent (ifNotExists) so the migration is safe on databases
 * where the columns may already have been created manually.
 */
export const up = pgm => {
  pgm.addColumns(
    'incidents',
    {
      acknowledged_at: { type: 'timestamptz' },
      escalated_at: { type: 'timestamptz' },
      reminder_count: { type: 'integer', notNull: true, default: 0 },
      last_reminder_at: { type: 'timestamptz' },
    },
    { ifNotExists: true },
  );
  pgm.addColumns(
    'notifications',
    {
      sound_pending: { type: 'boolean', notNull: true, default: false },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('incidents', ['status', 'created_at'], { ifNotExists: true });
  pgm.createIndex(
    'notifications',
    ['reference_type', 'reference_id'],
    { ifNotExists: true },
  );
};

export const down = pgm => {
  pgm.dropIndex('notifications', ['reference_type', 'reference_id'], {
    ifExists: true,
  });
  pgm.dropIndex('incidents', ['status', 'created_at'], { ifExists: true });
  pgm.dropColumns('notifications', ['sound_pending'], { ifExists: true });
  pgm.dropColumns(
    'incidents',
    ['acknowledged_at', 'escalated_at', 'reminder_count', 'last_reminder_at'],
    { ifExists: true },
  );
};
