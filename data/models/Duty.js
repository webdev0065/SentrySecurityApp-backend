const pool = require('../../db');

class Duty {
  static async findActiveLog(guardId) {
    const result = await pool.query(
      `SELECT * FROM duty_logs
       WHERE guard_id = $1 AND status = 'on_duty'
       ORDER BY clock_in_at DESC LIMIT 1`,
      [guardId]
    );
    return result.rows[0];
  }

  static async clockIn({ guardId, siteId, agencyId, photoUrl }) {
    const result = await pool.query(
      `INSERT INTO duty_logs (guard_id, site_id, agency_id, clock_in_photo)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [guardId, siteId, agencyId, photoUrl || null]
    );
    return result.rows[0];
  }

  static async clockOut(logId, guardId, photoUrl) {
    const result = await pool.query(
      `UPDATE duty_logs
       SET status = 'off_duty',
           clock_out_at = NOW(),
           clock_out_photo = $1,
           duration_minutes = EXTRACT(EPOCH FROM (NOW() - clock_in_at)) / 60
       WHERE id = $2 AND guard_id = $3 AND status = 'on_duty'
       RETURNING *`,
      [photoUrl || null, logId, guardId]
    );
    return result.rows[0];
  }

  static async calculateSalary(guardId, fromDate, toDate, basicSalary, shiftHours) {
    const WORKING_DAYS_PER_MONTH = 26;

    const result = await pool.query(
      `SELECT
         COALESCE(SUM(duration_minutes), 0) AS total_minutes,
         COUNT(*) AS total_shifts
       FROM duty_logs
       WHERE guard_id = $1
         AND status = 'off_duty'
         AND clock_in_at >= $2
         AND clock_in_at < ($3::date + INTERVAL '1 day')`,
      [guardId, fromDate, toDate]
    );

    const totalMinutes = Number(result.rows[0].total_minutes);
    const totalHours = totalMinutes / 60;
    const hourlyRate = basicSalary / (WORKING_DAYS_PER_MONTH * shiftHours);
    const calculatedPay = Math.round(totalHours * hourlyRate * 100) / 100;

    return {
      from: fromDate,
      to: toDate,
      total_shifts: Number(result.rows[0].total_shifts),
      total_minutes: totalMinutes,
      total_hours: Math.round(totalHours * 100) / 100,
      hourly_rate: Math.round(hourlyRate * 100) / 100,
      calculated_pay: calculatedPay
    };
  }

  static async findByGuardId(guardId, limit = 20) {
    const result = await pool.query(
      `SELECT d.*, s.site_name
       FROM duty_logs d
       JOIN sites s ON s.id = d.site_id
       WHERE d.guard_id = $1
       ORDER BY d.clock_in_at DESC
       LIMIT $2`,
      [guardId, limit]
    );
    return result.rows;
  }

  static async findByAgencyId(agencyId, limit = 50) {
    const result = await pool.query(
      `SELECT d.*, s.site_name, u.full_name AS guard_name
       FROM duty_logs d
       JOIN sites s ON s.id = d.site_id
       JOIN guards g ON g.id = d.guard_id
       JOIN users u ON u.id = g.user_id
       WHERE d.agency_id = $1
       ORDER BY d.clock_in_at DESC
       LIMIT $2`,
      [agencyId, limit]
    );
    return result.rows;
  }
}

module.exports = Duty;