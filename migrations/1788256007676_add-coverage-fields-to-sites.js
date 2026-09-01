export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumns('sites', {
    latitude: { type: 'decimal(10,7)' },
    longitude: { type: 'decimal(10,7)' },
    coverage_plan: { type: 'varchar(20)', notNull: true, default: 'day_shift' }, 
    start_time: { type: 'time' },
    end_time: { type: 'time' }
  });
};

export const down = (pgm) => {
  pgm.dropColumns('sites', ['latitude', 'longitude', 'coverage_plan', 'start_time', 'end_time']);
};