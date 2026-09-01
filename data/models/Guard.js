const pool = require('../../db');
const bcrypt = require('bcrypt');

class Guard {
  static async create({ agencyId, fullName, mobileNumber, siteId, coveragePlan, startTime, endTime, basicSalary, allowances }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const placeholderEmail = `${mobileNumber}@guard.placeholder.com`;
      const randomPassword = await bcrypt.hash(Math.random().toString(36), 10);

      const userResult = await client.query(
        `INSERT INTO users (full_name, mobile_number, email, password, account_type)
         VALUES ($1, $2, $3, $4, 'guard') RETURNING id`,
        [fullName, mobileNumber, placeholderEmail, randomPassword]
      );
      const userId = userResult.rows[0].id;

      const guardResult = await client.query(
        `INSERT INTO guards (user_id, agency_id, site_id, coverage_plan, start_time, end_time, basic_salary, allowances)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [userId, agencyId, siteId || null, coveragePlan || 'day_shift', startTime || null, endTime || null, basicSalary || null, allowances || 0]
      );

      await client.query('COMMIT');
      return { ...guardResult.rows[0], full_name: fullName, mobile_number: mobileNumber };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findByAgencyId(agencyId) {
    const result = await pool.query(
      `SELECT g.*, u.full_name, u.mobile_number, s.site_name
       FROM guards g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN sites s ON s.id = g.site_id
       WHERE g.agency_id = $1
       ORDER BY g.created_at DESC`,
      [agencyId]
    );
    return result.rows;
  }

  static async findById(id, agencyId) {
    const result = await pool.query(
      `SELECT g.*, u.full_name, u.mobile_number, s.site_name
       FROM guards g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN sites s ON s.id = g.site_id
       WHERE g.id = $1 AND g.agency_id = $2`,
      [id, agencyId]
    );
    return result.rows[0];
  }

  static async updateStatus(id, agencyId, status) {
    const result = await pool.query(
      `UPDATE guards SET status = $1 WHERE id = $2 AND agency_id = $3 RETURNING *`,
      [status, id, agencyId]
    );
    return result.rows[0];
  }

  static async updateLocation(id, agencyId, latitude, longitude) {
    const result = await pool.query(
      `UPDATE guards SET current_latitude = $1, current_longitude = $2 WHERE id = $3 AND agency_id = $4 RETURNING *`,
      [latitude, longitude, id, agencyId]
    );
    return result.rows[0];
  }
}

module.exports = Guard;