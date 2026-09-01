export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addColumn('agencies', {
    district: { type: 'varchar(100)' }
  });
};

export const down = (pgm) => {
  pgm.dropColumn('agencies', 'district');
};