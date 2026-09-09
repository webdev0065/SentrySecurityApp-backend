const pool = require('../../db');

class Notification {
  static async create({ type, title, message, referenceType, referenceId, targetRole }) {
    const result = await pool.query(
      `INSERT INTO notifications (type, title, message, reference_type, reference_id, target_role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unread') RETURNING *`,
      [type, title, message, referenceType, referenceId, targetRole]
    );
    return result.rows[0];
  }

  static async findForRole(targetRole, status) {
    if (status) {
      const result = await pool.query(
        `SELECT * FROM notifications WHERE target_role = $1 AND status = $2 ORDER BY created_at DESC`,
        [targetRole, status]
      );
      return result.rows;
    }
    const result = await pool.query(
      `SELECT * FROM notifications WHERE target_role = $1 ORDER BY created_at DESC`,
      [targetRole]
    );
    return result.rows;
  }

  static async markAsRead(id) {
    const result = await pool.query(
      `UPDATE notifications SET status = 'read', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0];
  }

  static async deleteByReference(referenceType, referenceId) {
    await pool.query(
      `DELETE FROM notifications WHERE reference_type = $1 AND reference_id = $2`,
      [referenceType, referenceId]
    );
  }
}

module.exports = Notification;