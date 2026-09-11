const pool = require('../../db');

class Client {
  static async create({
    userId,
    companyName,
    siteName,
    siteAddress,
    city,
    state,
    pincode,
  }) {
    const result = await pool.query(
      `INSERT INTO clients (user_id, company_name, site_name, site_address, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, companyName, siteName, siteAddress, city, state, pincode],
    );
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM clients WHERE user_id = $1',
      [userId],
    );
    return result.rows[0];
  }

  static async updateAvatar(userId, avatarUrl) {
    const result = await pool.query(
      `UPDATE clients SET avatar_url = $1 WHERE user_id = $2 RETURNING *`,
      [avatarUrl, userId],
    );
    return result.rows[0];
  }

  static async updateDetails(userId, updates) {
    const columns = {
      companyName: 'company_name',
      siteName: 'site_name',
      siteAddress: 'site_address',
      city: 'city',
      state: 'state',
      pincode: 'pincode',
    };
    const entries = Object.entries(updates).filter(
      ([key, value]) => columns[key] && value !== undefined,
    );

    if (!entries.length) return null;

    const values = entries.map(([, value]) => value);
    const assignments = entries
      .map(([key], index) => `${columns[key]} = $${index + 1}`)
      .join(', ');
    values.push(userId);

    const result = await pool.query(
      `UPDATE clients
       SET ${assignments}
       WHERE user_id = $${values.length}
       RETURNING *`,
      values,
    );
    return result.rows[0];
  }
}
module.exports = Client;
