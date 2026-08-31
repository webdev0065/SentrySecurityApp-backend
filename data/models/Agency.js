const pool = require('../../db');

class Agency {
  static async create({ userId, agencyName, businessType, gstNumber, officeAddress, city, state, pincode }) {
    const result = await pool.query(
      `INSERT INTO agencies (user_id, agency_name, business_type, gst_number, office_address, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, agencyName, businessType, gstNumber || null, officeAddress, city, state, pincode]
    );
   return result.rows[0];
  }
  static async findByUserId(userId) {
    const result = await pool.query('SELECT * FROM agencies WHERE user_id = $1', [userId]);
    return result.rows[0];
  }
}

module.exports = Agency;