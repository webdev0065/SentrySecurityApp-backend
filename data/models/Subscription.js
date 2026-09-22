const pool = require('../../db');

class Subscription {
  static async findActiveByAgencyId(agencyId) {
    const result = await pool.query(
      `SELECT s.*, p.name AS plan_name, p.price, p.max_guards, p.max_sites, p.features
       FROM agency_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.agency_id = $1 AND s.status = 'active'
       ORDER BY s.started_at DESC LIMIT 1`,
      [agencyId]
    );
    return result.rows[0];
  }

  static async switchPlan(agencyId, planId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE agency_subscriptions SET status = 'expired' WHERE agency_id = $1 AND status = 'active'`,
        [agencyId]
      );

      const result = await client.query(
        `INSERT INTO agency_subscriptions (agency_id, plan_id, status, started_at, renews_at)
         VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 month')
         RETURNING *`,
        [agencyId, planId]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async countGuards(agencyId) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM guards WHERE agency_id = $1`,
      [agencyId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  static async countSites(agencyId) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM sites WHERE agency_id = $1`,
      [agencyId]
    );
    return parseInt(result.rows[0].count, 10);
  }
}

module.exports = Subscription;