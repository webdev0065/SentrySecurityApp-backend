const pool = require('../../db');

class Agency {
  static async create({ userId, agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode }) {
    const result = await pool.query(
      `INSERT INTO agencies (user_id, agency_name, business_type, gst_number, office_address, city, state, district, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [userId, agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode]
    );
    return result.rows[0];
  }
  static async updateProfilePhoto(userId, photoUrl) {
  const result = await pool.query(
    `UPDATE agencies SET profile_photo_url = $1 WHERE user_id = $2 RETURNING *`,
    [photoUrl, userId]
  );
  return result.rows[0];
}
static async update(userId, { agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode }) {
  const result = await pool.query(
    `UPDATE agencies 
     SET agency_name = $1, business_type = $2, gst_number = $3, office_address = $4,
         city = $5, state = $6, district = $7, pincode = $8
     WHERE user_id = $9 RETURNING *`,
    [agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode, userId]
  );
  return result.rows[0];
}
  static async findByUserId(userId) {
    const result = await pool.query(
      `SELECT a.*, u.full_name, u.email, u.mobile_number
       FROM agencies a
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1`,
      [userId]
    );
    return result.rows[0];
  }
}

module.exports = Agency;