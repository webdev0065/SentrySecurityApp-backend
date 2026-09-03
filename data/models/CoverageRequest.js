const pool = require('../../db');

class CoverageRequest {
  static async create({ clientId, eventName, state, district, city, pincode, siteLocation, guardsNeeded, notes }) {
    const result = await pool.query(
      `INSERT INTO coverage_requests
        (client_id, event_name, state, district, city, pincode, site_location, guards_needed, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [clientId, eventName, state, district, city, pincode, siteLocation, guardsNeeded, notes]
    );
    return result.rows[0];
  }

  static async findByClientId(clientId) {
    const result = await pool.query(
      'SELECT * FROM coverage_requests WHERE client_id = $1 ORDER BY created_at DESC',
      [clientId]
    );
    return result.rows;
  }

  static async findById(id, clientId) {
    const result = await pool.query(
      'SELECT * FROM coverage_requests WHERE id = $1 AND client_id = $2',
      [id, clientId]
    );
    return result.rows[0];
  }

  static async findByAgencyId(agencyId) {
    const result = await pool.query(
      `SELECT cr.*, c.company_name
       FROM coverage_requests cr
       JOIN clients c ON c.id = cr.client_id
       WHERE cr.assigned_agency_id = $1
       ORDER BY cr.created_at DESC`,
      [agencyId]
    );
    return result.rows;
  }

  static async findPending() {
    const result = await pool.query(
      `SELECT cr.*, c.company_name
       FROM coverage_requests cr
       JOIN clients c ON c.id = cr.client_id
       WHERE cr.status = 'pending'
       ORDER BY cr.created_at ASC`
    );
    return result.rows;
  }

  static async updateStatus(id, status, assignedAgencyId) {
    const result = await pool.query(
      `UPDATE coverage_requests
       SET status = $1, assigned_agency_id = COALESCE($2, assigned_agency_id)
       WHERE id = $3 RETURNING *`,
      [status, assignedAgencyId || null, id]
    );
    return result.rows[0];
  }
}

module.exports = CoverageRequest;