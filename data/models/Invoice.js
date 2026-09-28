const pool = require('../../db');

/**
 * `date` columns are parsed by pg into a JS Date at local midnight, so
 * serialising them straight to JSON shifts the day (e.g. `2026-12-15` becomes
 * `2026-12-14T18:30:00.000Z` in IST). Normalise back to `YYYY-MM-DD` using
 * local date parts so the API always returns the stored day.
 */
const asISODate = value => {
  if (!(value instanceof Date)) return value;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const withISODate = row =>
  row && row.due_date ? { ...row, due_date: asISODate(row.due_date) } : row;

class Invoice {
  static async findClientsWithSummary(agencyId) {
    const result = await pool.query(
      `SELECT c.id AS client_id,
              c.company_name AS client_name,
              COUNT(g.id)::int AS guards_assigned,
              COALESCE(SUM(g.basic_salary + COALESCE(g.allowances, 0)), 0)::float AS total_salary
       FROM clients c
       JOIN coverage_requests cr ON cr.client_id = c.id
       JOIN sites s ON s.source_coverage_request_id = cr.id AND s.agency_id = $1
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
       JOIN coverage_requests cr ON cr.client_id = c.id
       JOIN sites s ON s.source_coverage_request_id = cr.id AND s.agency_id = $1
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
    return withISODate(result.rows[0]);
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
    return result.rows.map(withISODate);
  }

  static async findByClientId(clientId, status = null) {
    const params = [clientId];
    let statusCondition = '';
    if (status) {
      params.push(status);
      statusCondition = ' AND i.status = $2';
    }
    const result = await pool.query(
      `SELECT i.id,
              i.agency_id,
              i.client_id,
              i.amount,
              i.description,
              i.due_date,
              i.status,
              i.paid_at,
              i.created_at,
              c.site_name,
              a.agency_name
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       LEFT JOIN agencies a ON a.user_id = i.agency_id
       WHERE i.client_id = $1${statusCondition}
       ORDER BY i.created_at DESC`,
      params
    );
    return result.rows.map(withISODate);
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
    return withISODate(result.rows[0]);
  }
}

module.exports = Invoice;