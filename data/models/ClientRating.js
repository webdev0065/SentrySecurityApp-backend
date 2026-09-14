const pool = require('../../db');

class ClientRating {
  static async upsertAgency({ clientId, agencyId, rating, comment }) {
    const result = await pool.query(
      `INSERT INTO client_ratings (client_id, agency_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, agency_id) WHERE guard_id IS NULL
       DO UPDATE SET rating = EXCLUDED.rating,
                     comment = EXCLUDED.comment,
                     updated_at = NOW()
       RETURNING *`,
      [clientId, agencyId, rating, comment || null],
    );
    return result.rows[0];
  }

  static async upsertGuard({ clientId, agencyId, guardId, rating, comment }) {
    const result = await pool.query(
      `INSERT INTO client_ratings
        (client_id, agency_id, guard_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (client_id, guard_id) WHERE guard_id IS NOT NULL
       DO UPDATE SET rating = EXCLUDED.rating,
                     comment = EXCLUDED.comment,
                     agency_id = EXCLUDED.agency_id,
                     updated_at = NOW()
       RETURNING *`,
      [clientId, agencyId, guardId, rating, comment || null],
    );
    return result.rows[0];
  }

  static async findAgencySummary(clientId, agencyId) {
    const result = await pool.query(
      `SELECT
         ROUND(AVG(rating)::numeric, 1) AS average_rating,
         COUNT(*)::int AS rating_count,
         MAX(rating) FILTER (WHERE client_id = $1) AS client_rating,
         MAX(comment) FILTER (WHERE client_id = $1) AS client_comment
       FROM client_ratings
       WHERE agency_id = $2 AND guard_id IS NULL`,
      [clientId, agencyId],
    );
    return result.rows[0];
  }
}

module.exports = ClientRating;
