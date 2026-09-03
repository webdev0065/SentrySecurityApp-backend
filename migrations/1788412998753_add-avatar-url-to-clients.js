exports.up = (pgm) => {
  pgm.addColumn('clients', {
    avatar_url: {
      type: 'varchar(255)',
      notNull: false,
      default: null,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('clients', 'avatar_url');
};