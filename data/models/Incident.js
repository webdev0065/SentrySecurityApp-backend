const pool = require('../../db');

class Incident {
  static async create({ agencyId, siteId, severity, notes,guardId= null }) {
    const result = await pool.query(
      `INSERT INTO incidents (agency_id, site_id, severity, notes,guard_id)
       VALUES ($1, $2, $3, $4,$5) RETURNING *`,
      [agencyId, siteId, severity, notes, guardId]
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

  static async findByGuardUserId(userId) {
    const result = await pool.query(
      `SELECT i.*, s.site_name
       FROM incidents i
       JOIN guards g ON g.id = i.guard_id
       JOIN sites s ON s.id = i.site_id
       WHERE g.user_id = $1
       ORDER BY i.created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  static async findById(id, agencyId) {
    if (agencyId === null || agencyId === undefined) {
      const result = await pool.query(
        `SELECT i.*, s.site_name
         FROM incidents i
         JOIN sites s ON s.id = i.site_id
         WHERE i.id = $1`,
        [id],
      );
      return result.rows[0];
    }
    const result = await pool.query(
      `SELECT i.*, s.site_name
       FROM incidents i
       JOIN sites s ON s.id = i.site_id
       WHERE i.id = $1 AND i.agency_id = $2`,
      [id, agencyId],
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


  static async acknowledge(id, agencyId) {
    const result = await pool.query(
      `UPDATE incidents
       SET acknowledged_at = COALESCE(acknowledged_at, NOW())
       WHERE id = $1 AND agency_id = $2 AND acknowledged_at IS NULL
       RETURNING *`,
      [id, agencyId]
    );
    return result.rows[0];
  }

  /**
   * Incidents that are still inside their agency buzzer window and are due for
   * another burst. "Due" is derived from reminder_count, so the sweep is
   * idempotent — bursts land at 0, 5, 10 and 15 minutes:
   *   created_at + reminder_count * 5 minutes <= now
   *
   * reminder_count < 4 is what actually caps the loop at 4 bursts; the 20-minute
   * age bound only stops a long-abandoned incident from catching up all four
   * bursts at once. The bound is deliberately wider than the 15-minute window so
   * a late sweep still delivers the final burst instead of racing escalation.
   *
   * Acknowledged or escalated incidents are excluded: acknowledging stops the
   * buzzer, escalating hands the incident over to the (silent) client alerts.
   */
  static async findDueForSoundReminder() {
    const result = await pool.query(
      `SELECT i.id, i.reminder_count
       FROM incidents i
       WHERE i.acknowledged_at IS NULL
         AND i.escalated_at IS NULL
         AND (i.status IS NULL OR i.status IN ('pending', 'open'))
         AND i.reminder_count < 4
         AND i.created_at > NOW() - INTERVAL '20 minutes'
         AND i.created_at + (i.reminder_count * INTERVAL '5 minutes') <= NOW()
       ORDER BY i.created_at ASC`,
    );
    return result.rows;
  }

  /**
   * Incidents that have been waiting on the agency for 15 minutes and must now
   * also reach the client's alerts.
   *
   * Escalation deliberately does NOT fire the instant the buzzer window ends:
   * the final burst is armed at minute 15 and the app only polls every 30s, so
   * escalation waits one minute after last_reminder_at before clearing the flag.
   * Without that grace the 4th buzz would be wiped before the agency could hear
   * it. An acknowledged incident has nothing left to play, so it escalates at
   * minute 15 straight away, and the 25-minute hard deadline guarantees nothing
   * is ever stranded if the buzzer sweep was starved.
   */
  static async findPendingForEscalation() {
    const result = await pool.query(
      `SELECT i.*, s.site_name
       FROM incidents i
       JOIN sites s ON s.id = i.site_id
       WHERE i.escalated_at IS NULL
         AND i.created_at <= NOW() - INTERVAL '15 minutes'
         AND (
           (
             i.reminder_count >= 4
             AND i.last_reminder_at <= NOW() - INTERVAL '1 minute'
           )
           OR i.acknowledged_at IS NOT NULL
           OR i.created_at <= NOW() - INTERVAL '25 minutes'
         )`,
    );
    return result.rows;
  }

  static async markReminderSent(id) {
    const result = await pool.query(
      `UPDATE incidents 
       SET reminder_count = reminder_count + 1, last_reminder_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  static async escalateToClient(id) {
    const result = await pool.query(
      `UPDATE incidents
       SET escalated_at = COALESCE(escalated_at, NOW())
       WHERE id = $1 AND escalated_at IS NULL RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  static async findEscalatedByClientId(clientId) {
    const result = await pool.query(
      `SELECT DISTINCT i.*, s.site_name, a.agency_name
       FROM incidents i
       JOIN sites s ON s.id = i.site_id
       JOIN agencies a ON a.user_id = i.agency_id
       LEFT JOIN coverage_requests cr ON cr.id = s.source_coverage_request_id
       WHERE cr.client_id = $1 AND i.escalated_at IS NOT NULL
       ORDER BY i.escalated_at DESC`,
      [clientId]
    );
    return result.rows;
  }
}

module.exports = Incident;
