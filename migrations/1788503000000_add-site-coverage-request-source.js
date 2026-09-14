export const shorthands = undefined;

export const up = pgm => {
  pgm.addColumn('sites', {
    source_coverage_request_id: {
      type: 'integer',
      references: 'coverage_requests',
      onDelete: 'SET NULL',
      unique: true,
    },
  });
};

export const down = pgm => {
  pgm.dropColumn('sites', 'source_coverage_request_id');
};
