exports.up = (pgm) => {
  pgm.addColumn('agencies', {
    profile_photo_url: {
      type: 'varchar(255)',
      notNull: false
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('agencies', 'profile_photo_url');
};