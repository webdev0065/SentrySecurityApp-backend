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
      `SELECT c.*, u.full_name, u.email, u.mobile_number
       FROM clients c
       JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $1`,
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
    const userColumns = {
      fullName: 'full_name',
      email: 'email',
      mobileNumber: 'mobile_number',
    };
    const userEntries = Object.entries(updates).filter(
      ([key, value]) => userColumns[key] && value !== undefined,
    );
    if (!entries.length && !userEntries.length) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (entries.length) {
        const values = entries.map(([, value]) => value);
        const assignments = entries
          .map(([key], index) => `${columns[key]} = $${index + 1}`)
          .join(', ');
        await client.query(
          `UPDATE clients SET ${assignments}
           WHERE user_id = $${values.length + 1}`,
          [...values, userId],
        );
      }
      if (userEntries.length) {
        const values = userEntries.map(([, value]) => value);
        const assignments = userEntries
          .map(([key], index) => `${userColumns[key]} = $${index + 1}`)
          .join(', ');
        await client.query(
          `UPDATE users SET ${assignments}
           WHERE id = $${values.length + 1}`,
          [...values, userId],
        );
      }
      await client.query('COMMIT');
      return this.findByUserId(userId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
module.exports = Client;
