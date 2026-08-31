const pool = require('../../db');

class Client {
  static async create({ userId, companyName, siteName, siteAddress, city, state, pincode }) {
    const result = await pool.query(
      `INSERT INTO clients (user_id, company_name, site_name, site_address, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, companyName, siteName, siteAddress, city, state, pincode]
    );
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await pool.query('SELECT * FROM clients WHERE user_id = $1', [userId]);
    return result.rows[0];
  }
}

module.exports = Client;