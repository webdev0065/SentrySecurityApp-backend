const pool = require('../../db');

class Site {
  static async createFromCoverageRequest({ agencyId, request }) {
    const result = await pool.query(
      `INSERT INTO sites
      (agency_id, site_name, site_address, city, state, coverage_plan, source_coverage_request_id)
     VALUES ($1, $2, $3, $4, $5, 'day_shift', $6)
     ON CONFLICT (source_coverage_request_id) DO UPDATE
       SET site_name = EXCLUDED.site_name,
           site_address = EXCLUDED.site_address,
           city = EXCLUDED.city,
           state = EXCLUDED.state
     RETURNING *`,
      [
        agencyId,
        request.event_name || request.site_location,
        request.site_location,
        request.city,
        request.state,
        request.id,
      ],
    );
    return result.rows[0];
  }

  static async create({
    agencyId,
    siteName,
    siteAddress,
    city,
    state,
    latitude,
    longitude,
    coveragePlan,
    startTime,
    endTime,
  }) {
    const result = await pool.query(
      `INSERT INTO sites (agency_id, site_name, site_address, city, state, latitude, longitude, coverage_plan, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        agencyId,
        siteName,
        siteAddress,
        city,
        state,
        latitude || null,
        longitude || null,
        coveragePlan || 'day_shift',
        startTime || null,
        endTime || null,
      ],
    );
    return result.rows[0];
  }

  static async findByAgencyId(agencyId) {
    const result = await pool.query(
      'SELECT * FROM sites WHERE agency_id = $1 ORDER BY created_at DESC',
      [agencyId],
    );
    return result.rows;
  }
  static async deleteById(id, agencyId) {
    const result = await pool.query(
      `DELETE FROM sites
     WHERE id = $1 AND agency_id = $2
     RETURNING id`,
      [id, agencyId]
    );
    return result.rows[0];
  }
  static async findById(id, agencyId) {
    const result = await pool.query(
      'SELECT * FROM sites WHERE id = $1 AND agency_id = $2',
      [id, agencyId],
    );
    return result.rows[0];
  }
}

module.exports = Site;
