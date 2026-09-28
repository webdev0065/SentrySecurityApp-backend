const pool = require('../../db');

class Invoice {
  static async findClientsWithSummary(agencyId) {
    const result = await pool.query(
      `SELECT c.id AS client_id,
              c.company_name AS client_name,
              COUNT(g.id)::int AS guards_assigned,
              COALESCE(SUM(g.basic_salary + COALESCE(g.allowances, 0)), 0)::float AS total_salary
       FROM clients c
       JOIN sites s ON s.client_id = c.id AND s.agency_id = $1
       LEFT JOIN guards g ON g.site_id = s.id AND g.agency_id = $1
       GROUP BY c.id, c.company_name
       ORDER BY c.company_name ASC`,
      [agencyId]
    );
    return result.rows;
  }

  static async getClientSummary(agencyId, clientId) {
    const result = await pool.query(
      `SELECT c.id AS client_id,
              c.user_id,
              c.company_name AS client_name,
              c.site_name,
              COUNT(g.id)::int AS guards_assigned,
              COALESCE(SUM(g.basic_salary + COALESCE(g.allowances, 0)), 0)::float AS total_salary
       FROM clients c
       JOIN sites s ON s.client_id = c.id AND s.agency_id = $1
       LEFT JOIN guards g ON g.site_id = s.id AND g.agency_id = $1
       WHERE c.id = $2
       GROUP BY c.id, c.user_id, c.company_name, c.site_name`,
      [agencyId, clientId]
    );
    return result.rows[0];
  }

  static async create({ agencyId, clientId, amount, description, dueDate }) {
    const result = await pool.query(
      `INSERT INTO invoices (agency_id, client_id, amount, description, due_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [agencyId, clientId, amount, description || null, dueDate]
    );
    return result.rows[0];
  }

  static async findByAgencyId(agencyId, status = null) {
    const params = [agencyId];
    let statusCondition = '';
    if (status) {
      params.push(status);
      statusCondition = ' AND i.status = $2';
    }
    const result = await pool.query(
      `SELECT i.*, c.company_name AS client_name, c.site_name
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       WHERE i.agency_id = $1${statusCondition}
       ORDER BY i.created_at DESC`,
      params
    );
    return result.rows;
  }

  static async updateStatus(id, agencyId, status) {
    const result = await pool.query(
      `UPDATE invoices
       SET status = $1::varchar,
           paid_at = CASE WHEN $1::varchar = 'paid' THEN NOW() ELSE NULL END
       WHERE id = $2 AND agency_id = $3
       RETURNING *`,
      [status, id, agencyId]
    );
    return result.rows[0];
  }
}

module.exports = Invoice;