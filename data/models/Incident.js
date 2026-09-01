const pool = require('../../db');

class Incident {
  static async create({ agencyId, siteId, severity, notes }) {
    const result = await pool.query(
      `INSERT INTO incidents (agency_id, site_id, severity, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [agencyId, siteId, severity, notes]
    );
    return result.rows[0];
  }

  static async addImages(incidentId, imageUrls) {
    if (!imageUrls || imageUrls.length === 0) return [];
    const values = imageUrls.map((_, i) => `($1, $${i + 2})`).join(', ');
    const result = await pool.query(
      `INSERT INTO incident_images (incident_id, image_url) VALUES ${values} RETURNING *`,
      [incidentId, ...imageUrls]
    );
    return result.rows;
  }

  static async getImages(incidentId) {
    const result = await pool.query(
      'SELECT * FROM incident_images WHERE incident_id = $1',
      [incidentId]
    );
    return result.rows;
  }

  static async findByAgencyId(agencyId) {
    const result = await pool.query(
      `SELECT i.*, s.site_name
       FROM incidents i
       JOIN sites s ON s.id = i.site_id
       WHERE i.agency_id = $1
       ORDER BY i.created_at DESC`,
      [agencyId]
    );
    return result.rows;
  }

  static async findById(id, agencyId) {
    const result = await pool.query(
      `SELECT i.*, s.site_name
       FROM incidents i
       JOIN sites s ON s.id = i.site_id
       WHERE i.id = $1 AND i.agency_id = $2`,
      [id, agencyId]
    );
    return result.rows[0];
  }

  static async updateStatus(id, agencyId, status) {
    const result = await pool.query(
      `UPDATE incidents SET status = $1 WHERE id = $2 AND agency_id = $3 RETURNING *`,
      [status, id, agencyId]
    );
    return result.rows[0];
  }
}

module.exports = Incident;