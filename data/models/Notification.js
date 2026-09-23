const pool = require('../../db');

class Notification {
  static async create({
    type,
    title,
    message,
    referenceType,
    referenceId,
    targetRole,
  }) {
    const result = await pool.query(
      `INSERT INTO notifications (type, title, message, reference_type, reference_id, target_role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unread') RETURNING *`,
      [type, title, message, referenceType, referenceId, targetRole],
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
      `SELECT * FROM notifications WHERE ${conditions.join(
        ' AND ',
      )} ORDER BY created_at DESC`,
      params,
    );
    return result.rows;
  }

  static async countUnreadForRole(targetRole, recipientId = null) {
    const recipientCondition = recipientId ? ' AND recipient_id = $2' : '';
    const params = recipientId ? [targetRole, recipientId] : [targetRole];
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE target_role = $1${recipientCondition} AND status = 'unread'`,
      params,
    );
    return result.rows[0].count;
  }

  static async markAsRead(id, targetRole, recipientId = null) {
    const recipientCondition = recipientId ? ' AND recipient_id = $3' : '';
    const params = recipientId
      ? [id, targetRole, recipientId]
      : [id, targetRole];
    const result = await pool.query(
      `UPDATE notifications
       SET status = 'read', updated_at = NOW()
       WHERE id = $1 AND target_role = $2${recipientCondition}
       RETURNING *`,
      params,
    );
    return result.rows[0];
  }

  static async markAllAsRead(targetRole, recipientId = null) {
    const recipientCondition = recipientId ? ' AND recipient_id = $2' : '';
    const params = recipientId ? [targetRole, recipientId] : [targetRole];
    await pool.query(
      `UPDATE notifications
       SET status = 'read', updated_at = NOW()
       WHERE target_role = $1${recipientCondition} AND status = 'unread'`,
      params,
    );
  }

  static async deleteById(id, targetRole, recipientId = null) {
    const recipientCondition = recipientId ? ' AND recipient_id = $3' : '';
    const params = recipientId
      ? [id, targetRole, recipientId]
      : [id, targetRole];
    const result = await pool.query(
      `DELETE FROM notifications
       WHERE id = $1 AND target_role = $2${recipientCondition}
       RETURNING id`,
      params,
    );
    return result.rows[0];
  }
  static async createForRecipient({
    recipientId,
    recipientType,
    type,
    targetRole,
    title,
    message,
    referenceType,
    referenceId,
  }) {
    const result = await pool.query(
      `INSERT INTO notifications 
      (recipient_id, recipient_type, type, target_role, title, message, reference_type, reference_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread') RETURNING *`,
      [
        recipientId,
        recipientType,
        type,
        targetRole,
        title,
        message,
        referenceType,
        referenceId,
      ],
    );
    return result.rows[0];
  }
  static async deleteByReference(referenceType, referenceId) {
    await pool.query(
      `DELETE FROM notifications WHERE reference_type = $1 AND reference_id = $2`,
      [referenceType, referenceId],
    );
  }

  static async consumeSoundPendingByReference(referenceType, referenceId) {
    // Scoped variant used by legacy callers.
    const result = await pool.query(
      `UPDATE notifications SET sound_pending = false
       WHERE reference_type = $1 AND reference_id = $2 AND sound_pending = true
       RETURNING id`,
      [referenceType, referenceId],
    );
    return result.rows;
  }

  // Agency buzzer poll: consume every pending flag for this role so each
  // 5-minute backend tick triggers exactly one buzzer burst per poll cycle.
  static async consumeSoundPending(targetRole, recipientId = null) {
    const recipientCondition = recipientId ? ' AND recipient_id = $2' : '';
    const params = recipientId ? [targetRole, recipientId] : [targetRole];
    const result = await pool.query(
      `UPDATE notifications SET sound_pending = false
       WHERE target_role = $1${recipientCondition} AND sound_pending = true
       RETURNING id`,
      params,
    );
    return result.rows;
  }

  /**
   * Flags (or clears) the buzzer for every notification tied to a reference.
   * Pass targetRole to scope it — the incident buzzer must only ever be armed
   * for 'agency' notifications, never for the client escalation copy.
   */
  static async markSoundPendingByReference(
    referenceType,
    referenceId,
    value,
    targetRole = null,
  ) {
    const roleCondition = targetRole ? ' AND target_role = $4' : '';
    const params = targetRole
      ? [value, referenceType, referenceId, targetRole]
      : [value, referenceType, referenceId];
    return pool.query(
      `UPDATE notifications SET sound_pending = $1
       WHERE reference_type = $2 AND reference_id = $3${roleCondition}`,
      params,
    );
  }
}

module.exports = Notification;
