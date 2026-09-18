const pool = require('../../db');

class Patrol {

  static async createCheckpoint({ siteId, name, sequenceOrder, latitude, longitude }) {
    const result = await pool.query(
      `INSERT INTO checkpoints (site_id, name, sequence_order, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [siteId, name, sequenceOrder || 1, latitude || null, longitude || null]
    );
    return result.rows[0];
  }

  static async findCheckpointsBySiteId(siteId) {
    const result = await pool.query(
      `SELECT * FROM checkpoints
       WHERE site_id = $1 AND is_active = true
       ORDER BY sequence_order ASC, id ASC`,
      [siteId]
    );
    return result.rows;
  }

  static async findCheckpointById(id) {
    const result = await pool.query(
      `SELECT c.*, s.agency_id
       FROM checkpoints c
       JOIN sites s ON s.id = c.site_id
       WHERE c.id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async updateCheckpoint(id, siteId, { name, sequenceOrder, latitude, longitude }) {
    const result = await pool.query(
      `UPDATE checkpoints
       SET name = COALESCE($1, name),
           sequence_order = COALESCE($2, sequence_order),
           latitude = COALESCE($3, latitude),
           longitude = COALESCE($4, longitude),
           updated_at = NOW()
       WHERE id = $5 AND site_id = $6
       RETURNING *`,
      [name || null, sequenceOrder || null, latitude || null, longitude || null, id, siteId]
    );
    return result.rows[0];
  }

  static async deleteCheckpoint(id, siteId) {
    const result = await pool.query(
      `UPDATE checkpoints SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND site_id = $2 RETURNING id`,
      [id, siteId]
    );
    return result.rows[0];
  }

  static async findActiveRound(guardId) {
    const result = await pool.query(
      `SELECT * FROM patrol_rounds
       WHERE guard_id = $1 AND status = 'in_progress'
       ORDER BY started_at DESC LIMIT 1`,
      [guardId]
    );
    return result.rows[0];
  }

  static async startRound({ guardId, siteId, agencyId, totalCheckpoints }) {
    const result = await pool.query(
      `INSERT INTO patrol_rounds (guard_id, site_id, agency_id, total_checkpoints)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [guardId, siteId, agencyId, totalCheckpoints]
    );
    return result.rows[0];
  }

  static async completeRound(roundId) {
    const result = await pool.query(
      `UPDATE patrol_rounds
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1 RETURNING *`,
      [roundId]
    );
    return result.rows[0];
  }

  static async findRoundById(roundId) {
    const result = await pool.query(
      `SELECT r.*, s.site_name
       FROM patrol_rounds r
       JOIN sites s ON s.id = r.site_id
       WHERE r.id = $1`,
      [roundId]
    );
    return result.rows[0];
  }

  static async findRoundsByGuardId(guardId, limit = 20) {
    const result = await pool.query(
      `SELECT r.*, s.site_name
       FROM patrol_rounds r
       JOIN sites s ON s.id = r.site_id
       WHERE r.guard_id = $1
       ORDER BY r.started_at DESC
       LIMIT $2`,
      [guardId, limit]
    );
    return result.rows;
  }

  static async findRoundsByAgencyId(agencyId, limit = 50) {
    const result = await pool.query(
      `SELECT r.*, s.site_name, u.full_name AS guard_name
       FROM patrol_rounds r
       JOIN sites s ON s.id = r.site_id
       JOIN guards g ON g.id = r.guard_id
       JOIN users u ON u.id = g.user_id
       WHERE r.agency_id = $1
       ORDER BY r.started_at DESC
       LIMIT $2`,
      [agencyId, limit]
    );
    return result.rows;
  }

  static async scanCheckpoint({ roundId, checkpointId, guardId }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const scanResult = await client.query(
        `INSERT INTO patrol_scans (round_id, checkpoint_id, guard_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (round_id, checkpoint_id) DO NOTHING
         RETURNING *`,
        [roundId, checkpointId, guardId]
      );

      if (!scanResult.rows[0]) {
        await client.query('ROLLBACK');
        return { alreadyScanned: true };
      }

      const roundResult = await client.query(
        `UPDATE patrol_rounds
         SET scanned_count = scanned_count + 1
         WHERE id = $1 RETURNING *`,
        [roundId]
      );

      const round = roundResult.rows[0];
      let completed = false;

      if (round.scanned_count >= round.total_checkpoints) {
        await client.query(
          `UPDATE patrol_rounds SET status = 'completed', completed_at = NOW() WHERE id = $1`,
          [roundId]
        );
        completed = true;
      }

      await client.query('COMMIT');
      return { scan: scanResult.rows[0], round, completed };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findScansByRoundId(roundId) {
    const result = await pool.query(
      `SELECT ps.*, c.name AS checkpoint_name, c.sequence_order
       FROM patrol_scans ps
       JOIN checkpoints c ON c.id = ps.checkpoint_id
       WHERE ps.round_id = $1
       ORDER BY ps.scanned_at ASC`,
      [roundId]
    );
    return result.rows;
  }
}

module.exports = Patrol;