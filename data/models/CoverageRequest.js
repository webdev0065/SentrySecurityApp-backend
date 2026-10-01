const pool = require('../../db');

function normalizeCheckpointInput(value, index) {
  const name = String(value?.name ?? '').trim();
  if (!name) return { error: 'Checkpoint name is required' };
  if (name.length > 255) return { error: 'Checkpoint name is too long' };
  return { name, sequence_order: index + 1 };
}

class CoverageRequest {
  static validateCheckpointList(checkpoints) {
    if (checkpoints === undefined) return { checkpoints: [] };
    if (!Array.isArray(checkpoints)) return { error: 'checkpoints must be an array' };
    if (checkpoints.length > 20) return { error: 'A maximum of 20 checkpoints is allowed' };
    const normalized = [];
    const seen = new Set();
    for (let index = 0; index < checkpoints.length; index += 1) {
      const parsed = normalizeCheckpointInput(checkpoints[index], index);
      if (parsed.error) return { error: `Checkpoint ${index + 1}: ${parsed.error}` };
      if (seen.has(parsed.name.toLowerCase())) {
        return { error: `Checkpoint ${index + 1}: duplicate checkpoint name` };
      }
      seen.add(parsed.name.toLowerCase());
      normalized.push(parsed);
    }
    return { checkpoints: normalized };
  }

  static async create({
    clientId,
    eventName,
    state,
    district,
    city,
    siteLocation,
    guardsNeeded,
    notes,
    selectedAgencyId,
    checkpoints = [],
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO coverage_requests
        (client_id, event_name, state, district, city, site_location, guards_needed, notes, selected_agency_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          clientId,
          eventName,
          state,
          district,
          city,
          siteLocation,
          guardsNeeded,
          notes,
          selectedAgencyId || null,
        ],
      );
      const request = result.rows[0];
      for (const point of checkpoints) {
        await client.query(
          `INSERT INTO coverage_request_checkpoints
            (coverage_request_id, name, sequence_order)
           VALUES ($1, $2, $3)`,
          [request.id, point.name, point.sequence_order],
        );
      }
      await client.query('COMMIT');
      if (checkpoints.length) {
        request.checkpoints = await this.findCheckpointsByRequestId(request.id);
      } else {
        request.checkpoints = [];
      }
      return request;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async findByClientId(clientId) {
    const result = await pool.query(
      `SELECT cr.*,
              COALESCE(assigned.agency_name, selected.agency_name) AS agency_name,
              COALESCE(assigned.city, selected.city) AS agency_city,
              COALESCE(assigned.district, selected.district) AS agency_district
       FROM coverage_requests cr
       LEFT JOIN agencies selected ON selected.id = cr.selected_agency_id
       LEFT JOIN agencies assigned ON assigned.id = cr.assigned_agency_id
       WHERE cr.client_id = $1
       ORDER BY cr.created_at DESC`,
      [clientId],
    );
    return this.attachCheckpoints(result.rows);
  }

  // Attaches checkpoint lists to a batch of coverage requests with a single
  // query so list screens stay free of N+1 lookups.
  static async attachCheckpoints(requests) {
    if (!requests.length) return requests;
    const result = await pool.query(
      `SELECT id, coverage_request_id, name, sequence_order, created_at
       FROM coverage_request_checkpoints
       WHERE coverage_request_id = ANY($1::int[]) AND is_active = true
       ORDER BY sequence_order ASC, id ASC`,
      [requests.map(request => request.id)],
    );
    const grouped = new Map();
    for (const row of result.rows) {
      const list = grouped.get(row.coverage_request_id);
      if (list) {
        list.push(row);
      } else {
        grouped.set(row.coverage_request_id, [row]);
      }
    }
    for (const request of requests) {
      request.checkpoints = grouped.get(request.id) || [];
    }
    return requests;
  }

  static async findById(id, clientId) {
    const result = await pool.query(
      'SELECT * FROM coverage_requests WHERE id = $1 AND client_id = $2',
      [id, clientId],
    );
    const request = result.rows[0];
    if (request) {
      request.checkpoints = await this.findCheckpointsByRequestId(request.id);
    }
    return request;
  }

  static async findCheckpointsByRequestId(coverageRequestId) {
    const result = await pool.query(
      `SELECT id, coverage_request_id, name, sequence_order, created_at
       FROM coverage_request_checkpoints
       WHERE coverage_request_id = $1 AND is_active = true
       ORDER BY sequence_order ASC, id ASC`,
      [coverageRequestId],
    );
    return result.rows;
  }

  static async findByAgencyId(agencyId) {
    const result = await pool.query(
      `SELECT cr.*, c.company_name, c.site_name AS client_site_name,
              c.site_address AS client_address
       FROM coverage_requests cr
       JOIN clients c ON c.id = cr.client_id
       WHERE cr.selected_agency_id = $1 OR cr.assigned_agency_id = $1
       ORDER BY cr.created_at DESC`,
      [agencyId],
    );
    return this.attachCheckpoints(result.rows);
  }

  static async findForAgencyById(id, agencyId) {
    const result = await pool.query(
      `SELECT cr.*, c.company_name, c.site_name AS client_site_name,
              c.site_address AS client_address
       FROM coverage_requests cr
       JOIN clients c ON c.id = cr.client_id
       WHERE cr.id = $1
         AND (cr.selected_agency_id = $2 OR cr.assigned_agency_id = $2)`,
      [id, agencyId],
    );
    const request = result.rows[0];
    if (request) {
      request.checkpoints = await this.findCheckpointsByRequestId(request.id);
    }
    return request;
  }

  static async updateForAgency(id, agencyId, status, assignedGuardIds = null, db = pool) {
    const result = await db.query(
      `UPDATE coverage_requests
       SET status = $1::varchar,
           assigned_agency_id = CASE
             WHEN $1::varchar = 'rejected' THEN assigned_agency_id
             ELSE $2::integer
           END,
           assigned_guard_ids = COALESCE($3::integer[], assigned_guard_ids)
       WHERE id = $4
         AND (selected_agency_id = $2::integer OR assigned_agency_id = $2::integer)
       RETURNING *`,
      [status, agencyId, assignedGuardIds, id],
    );
    return result.rows[0];
  }

  static async findPending() {
    const result = await pool.query(
      `SELECT cr.*, c.company_name
       FROM coverage_requests cr
       JOIN clients c ON c.id = cr.client_id
       WHERE cr.status = 'pending'
       ORDER BY cr.created_at ASC`,
    );
    return result.rows;
  }

  static async updateStatus(id, status, assignedAgencyId) {
    const result = await pool.query(
      `UPDATE coverage_requests
       SET status = $1, assigned_agency_id = COALESCE($2, assigned_agency_id)
       WHERE id = $3 RETURNING *`,
      [status, assignedAgencyId || null, id],
    );
    return result.rows[0];
  }
}

module.exports = CoverageRequest;
