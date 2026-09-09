const pool = require('../../db');
const bcrypt = require('bcrypt');

class Guard {
  static async create({
    agencyId, fullName, mobileNumber, email, password, joiningDate,
    siteId, coveragePlan, shiftHours, startTime, endTime,
    basicSalary, allowances, address, age, gender
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const hashedPassword = await bcrypt.hash(password, 10);

      const userResult = await client.query(
        `INSERT INTO users (full_name, mobile_number, email, password, account_type)
         VALUES ($1, $2, $3, $4, 'guard') RETURNING id`,
        [fullName, mobileNumber, email, hashedPassword]
      );
      const userId = userResult.rows[0].id;

      const guardResult = await client.query(
        `INSERT INTO guards (
           user_id, agency_id, site_id, coverage_plan, shift_hours,
           joining_date, start_time, end_time, basic_salary, allowances,
           address, age, gender
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          userId, agencyId, siteId || null, coveragePlan || 'day_shift',
          coveragePlan === '24x7' ? null : shiftHours,
          joiningDate || null, startTime || null, endTime || null,
          basicSalary || null, allowances || 0,
          address || null, age || null, gender || null
        ]
      );

      await client.query('COMMIT');
      return { ...guardResult.rows[0], full_name: fullName, mobile_number: mobileNumber, email };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findByAgencyId(agencyId) {
    const result = await pool.query(
      `SELECT g.*, u.full_name, u.mobile_number, u.email, s.site_name
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
      `SELECT g.*, u.full_name, u.mobile_number, u.email, s.site_name
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

  static async update(id, agencyId, {
    siteId, coveragePlan, shiftHours, startTime, endTime,
    basicSalary, allowances, address, age, gender, rating
  }) {
    const result = await pool.query(
      `UPDATE guards
     SET site_id = COALESCE($1, site_id),
         coverage_plan = COALESCE($2, coverage_plan),
         shift_hours = COALESCE($3, shift_hours),
         start_time = COALESCE($4, start_time),
         end_time = COALESCE($5, end_time),
         basic_salary = COALESCE($6, basic_salary),
         allowances = COALESCE($7, allowances),
         address = COALESCE($8, address),
         age = COALESCE($9, age),
         gender = COALESCE($10, gender),
         rating = COALESCE($11, rating)
     WHERE id = $12 AND agency_id = $13
     RETURNING *`,
      [
        siteId ?? null, coveragePlan ?? null, shiftHours ?? null,
        startTime ?? null, endTime ?? null, basicSalary ?? null,
        allowances ?? null, address ?? null, age ?? null, gender ?? null, rating ?? null,
        id, agencyId
      ]
    );
    return result.rows[0];
  }
}

module.exports = Guard;