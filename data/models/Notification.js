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

  static async findForRole(targetRole, status, recipientId = null) {
  const conditions = ['target_role = $1'];
  const params = [targetRole];

  if (recipientId) {
    conditions.push(`recipient_id = $${params.length + 1}`);
    params.push(recipientId);
  }
  if (status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(status);
  }

  console.log('QUERY:', conditions.join(' AND '));  
  console.log('PARAMS:', params);                     

  const result = await pool.query(
    `SELECT * FROM notifications WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  return result.rows;
}

  static async countUnreadForRole(targetRole) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE target_role = $1 AND status = 'unread'`,
      [targetRole]
    );
    return result.rows[0].count;
  }

  static async markAsRead(id, targetRole) {
    const result = await pool.query(
      `UPDATE notifications
       SET status = 'read', updated_at = NOW()
       WHERE id = $1 AND target_role = $2
       RETURNING *`,
      [id, targetRole]
    );
    return result.rows[0];
  }

  static async markAllAsRead(targetRole) {
    await pool.query(
      `UPDATE notifications
       SET status = 'read', updated_at = NOW()
       WHERE target_role = $1 AND status = 'unread'`,
      [targetRole]
    );
  }

  static async deleteById(id, targetRole) {
    const result = await pool.query(
      `DELETE FROM notifications
       WHERE id = $1 AND target_role = $2
       RETURNING id`,
      [id, targetRole]
    );
    return result.rows[0];
  }
  static async createForRecipient({ recipientId, recipientType, type, targetRole, title, message, referenceType, referenceId }) {
    const result = await pool.query(
      `INSERT INTO notifications 
      (recipient_id, recipient_type, type, target_role, title, message, reference_type, reference_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread') RETURNING *`,
      [recipientId, recipientType, type, targetRole, title, message, referenceType, referenceId]
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
async function markSoundPendingByReference(referenceType, referenceId, value) {
  return db.query(
    'UPDATE notifications SET sound_pending = $1 WHERE reference_type = $2 AND reference_id = $3 RETURNING *',
    [value, referenceType, referenceId]
  );
}
module.exports.markSoundPendingByReference = markSoundPendingByReference;
module.exports = Notification;
