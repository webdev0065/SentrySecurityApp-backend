export const shorthands = undefined;

export const up = pgm => {
  pgm.sql("UPDATE incidents SET status = 'pending' WHERE status = 'open'");
  pgm.sql("UPDATE incidents SET status = 'in_progress' WHERE status = 'acknowledged'");
  pgm.alterColumn('incidents', 'status', { default: 'pending' });
};

export const down = pgm => {
  pgm.alterColumn('incidents', 'status', { default: 'open' });
};
