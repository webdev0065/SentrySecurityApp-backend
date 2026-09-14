export const shorthands = undefined;

export const up = pgm => {
  pgm.addColumn('coverage_requests', {
    assigned_guard_ids: { type: 'integer[]' },
  });
};

export const down = pgm => {
  pgm.dropColumn('coverage_requests', 'assigned_guard_ids');
};
