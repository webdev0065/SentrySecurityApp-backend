const pool = require('../../db');

/**
 * Agency Payroll Management.
 *
 * Business rules (single source of truth — the backend is authoritative):
 *  - Period is a payroll month keyed by its first day (YYYY-MM-01).
 *  - One payroll record per (agency, guard, period).
 *  - Net salary:  gross = basic + overtime + allowances
 *                 net   = gross - deductions - advance_recovery
 *  - `advance_recovery` is the outstanding advance balance captured when the
 *    record is SAVED and the amount actually recovered when it is PAID. It is
 *    applied exactly once: marking paid flips the covered advances to
 *    `recovered` in the same transaction, so they can never be double counted.
 *  - Overtime is an agency-entered component. The application does not define
 *    an overtime rate/threshold anywhere, so no automatic multiplier is applied
 *    (we do not invent a rule). It defaults to 0 and is validated server-side.
 *  - A paid record is immutable to salary edits and cannot be paid twice.
 */

const MAX_AMOUNT = 99999999.99;

/** Parse pg numeric (string) into a safe, non-negative, 2dp number. */
const toMoney = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
};

/** Postgres returns `date` columns as a Date at local midnight → YYYY-MM-DD. */
const asISODate = value => {
  if (!(value instanceof Date)) return value;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Normalise every numeric field on a payroll row into JS numbers. */
const withNumbers = row =>
  row && {
    ...row,
    period: asISODate(row.period),
    basic_salary: toMoney(row.basic_salary),
    overtime: toMoney(row.overtime),
    allowances: toMoney(row.allowances),
    deductions: toMoney(row.deductions),
    advance_recovery: toMoney(row.advance_recovery),
    net_salary: toMoney(row.net_salary),
  };

/** Validate a payroll month is YYYY-MM-01. */
const isValidPeriod = value =>
  typeof value === 'string' && /^\d{4}-\d{2}-01$/.test(value);

const round2 = n => Math.round(n * 100) / 100;

class Payroll {
  // -------------------------------------------------------------------------
  // Overview — guards with their payroll record for the selected period.
  //
  // Every guard belongs to the agency so the list is complete; a saved record
  // supplies the amount + status, otherwise the guard shows their configured
  // base pay (basic + allowances) as a pending, not-yet-generated entry. The
  // summary is derived from the SAME rows in the service so the two never
  // disagree.
  // -------------------------------------------------------------------------
  static async findOverviewByPeriod(agencyId, period) {
    const result = await pool.query(
      `SELECT
         g.id                        AS guard_id,
         u.full_name,
         pr.id                       AS payroll_id,
         pr.status,
         pr.paid_at,
         COALESCE(pr.net_salary,
                  COALESCE(g.basic_salary, 0) + COALESCE(g.allowances, 0)
         )                          AS amount
       FROM guards g
       JOIN users u ON u.id = g.user_id
       LEFT JOIN payroll_records pr
         ON pr.guard_id = g.id AND pr.agency_id = g.agency_id AND pr.period = $2
       WHERE g.agency_id = $1
       ORDER BY u.full_name ASC`,
      [agencyId, period],
    );
    return result.rows.map(row => ({
      guard_id: Number(row.guard_id),
      full_name: row.full_name,
      payroll_id: row.payroll_id ? Number(row.payroll_id) : null,
      // No persisted record yet → still pending, but not generated.
      status: row.status || 'pending',
      amount: toMoney(row.amount),
      paid_at: row.paid_at || null,
    }));
  }

  /**
   * Summary totals derived from the overview rows (same source as the list).
   * total    = sum of every payroll amount for the period.
   * verified = records in verified (or paid) state.
   * pending  = records still awaiting action.
   */
  static summarize(rows) {
    return rows.reduce(
      (acc, row) => {
        acc.total = round2(acc.total + row.amount);
        if (row.status === 'verified' || row.status === 'paid') acc.verified += 1;
        else acc.pending += 1;
        return acc;
      },
      { total: 0, verified: 0, pending: 0 },
    );
  }

  // -------------------------------------------------------------------------
  // Details
  // -------------------------------------------------------------------------
  static async getRecord(agencyId, guardId, period) {
    const result = await pool.query(
      `SELECT pr.*
         FROM payroll_records pr
        WHERE pr.agency_id = $1 AND pr.guard_id = $2 AND pr.period = $3`,
      [agencyId, guardId, period],
    );
    return withNumbers(result.rows[0]);
  }

  /** Guard identity + configured base pay, scoped to the agency. */
  static async getGuardContext(agencyId, guardId) {
    const result = await pool.query(
      `SELECT g.id, u.full_name, u.mobile_number, s.site_name,
              COALESCE(g.basic_salary, 0) AS basic_salary,
              COALESCE(g.allowances, 0) AS allowances,
              g.shift_hours
         FROM guards g
         JOIN users u ON u.id = g.user_id
         LEFT JOIN sites s ON s.id = g.site_id
        WHERE g.id = $1 AND g.agency_id = $2`,
      [guardId, agencyId],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: Number(row.id),
      full_name: row.full_name,
      mobile_number: row.mobile_number,
      site_name: row.site_name,
      basic_salary: toMoney(row.basic_salary),
      allowances: toMoney(row.allowances),
      shift_hours: row.shift_hours ? Number(row.shift_hours) : null,
    };
  }

  /** Outstanding advance balance for a guard (agency scoped). */
  static async outstandingAdvance(agencyId, guardId) {
    const result = await pool.query(
      `SELECT COALESCE(SUM(amount - recovered_amount), 0) AS outstanding,
              COUNT(*)::int AS open_count
         FROM salary_advances
        WHERE agency_id = $1 AND guard_id = $2 AND status = 'outstanding'`,
      [agencyId, guardId],
    );
    return {
      outstanding: toMoney(result.rows[0].outstanding),
      open_count: Number(result.rows[0].open_count) || 0,
    };
  }

  static async findAdvances(agencyId, guardId) {
    const result = await pool.query(
      `SELECT id, amount, recovered_amount, reason, status,
              recorded_at, recovered_at
         FROM salary_advances
        WHERE agency_id = $1 AND guard_id = $2
        ORDER BY recorded_at DESC`,
      [agencyId, guardId],
    );
    return result.rows.map(row => ({
      ...row,
      id: Number(row.id),
      amount: toMoney(row.amount),
      recovered_amount: toMoney(row.recovered_amount),
      outstanding: round2(toMoney(row.amount) - toMoney(row.recovered_amount)),
    }));
  }

  /**
   * Create or update the payroll record for a guard + period WITHOUT marking
   * it paid. Server recomputes the net salary (never trusting the client) and
   * refreshes the advance recovery from the current outstanding balance. Paid
   * records are locked.
   */
  static async save({ agencyId, guardId, period, components }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the guard row (agency-scoped) so concurrent saves serialise.
      const guardRes = await client.query(
        `SELECT id FROM guards WHERE id = $1 AND agency_id = $2 FOR UPDATE`,
        [guardId, agencyId],
      );
      if (!guardRes.rows.length) {
        await client.query('ROLLBACK');
        return { error: 'GUARD_NOT_FOUND' };
      }

      const existing = await client.query(
        `SELECT id, status FROM payroll_records
          WHERE agency_id = $1 AND guard_id = $2 AND period = $3 FOR UPDATE`,
        [agencyId, guardId, period],
      );

      const basicSalary = toMoney(components.basic_salary);
      const overtime = toMoney(components.overtime);
      const allowances = toMoney(components.allowances);
      const deductions = toMoney(components.deductions);

      const advanceRes = await client.query(
        `SELECT COALESCE(SUM(amount - recovered_amount), 0) AS outstanding
           FROM salary_advances
          WHERE agency_id = $1 AND guard_id = $2 AND status = 'outstanding'`,
        [agencyId, guardId],
      );
      const advanceRecovery = toMoney(advanceRes.rows[0].outstanding);

      const gross = round2(basicSalary + overtime + allowances);
      const net = Math.max(0, round2(gross - deductions - advanceRecovery));

      let record;
      if (existing.rows.length) {
        const current = existing.rows[0];
        if (current.status === 'paid') {
          await client.query('ROLLBACK');
          return { error: 'ALREADY_PAID' };
        }
        record = await client.query(
          `UPDATE payroll_records
              SET basic_salary = $1, overtime = $2, allowances = $3,
                  deductions = $4, advance_recovery = $5, net_salary = $6,
                  updated_at = NOW()
            WHERE id = $7
            RETURNING *`,
          [basicSalary, overtime, allowances, deductions, advanceRecovery, net, current.id],
        );
      } else {
        record = await client.query(
          `INSERT INTO payroll_records
             (agency_id, guard_id, period, basic_salary, overtime, allowances,
              deductions, advance_recovery, net_salary, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
           RETURNING *`,
          [agencyId, guardId, period, basicSalary, overtime, allowances, deductions, advanceRecovery, net],
        );
      }

      await client.query('COMMIT');
      return { record: withNumbers(record.rows[0]) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Mark a payroll record as paid. Transaction-safe and idempotent: a second
   * call returns ALREADY_PAID, and the covered advances are recovered here so
   * they can never be deducted from a future month.
   */
  static async markPaid({ agencyId, guardId, period }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query(
        `SELECT id, status, net_salary, advance_recovery
           FROM payroll_records
          WHERE agency_id = $1 AND guard_id = $2 AND period = $3 FOR UPDATE`,
        [agencyId, guardId, period],
      );
      if (!res.rows.length) {
        await client.query('ROLLBACK');
        return { error: 'NOT_FOUND' };
      }
      const record = res.rows[0];
      if (record.status === 'paid') {
        await client.query('ROLLBACK');
        return { error: 'ALREADY_PAID', record: withNumbers(record) };
      }

      const updated = await client.query(
        `UPDATE payroll_records
            SET status = 'paid',
                verified_at = COALESCE(verified_at, NOW()),
                paid_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [record.id],
      );

      // Recover the advances that funded this payroll, exactly once.
      const recovery = toMoney(record.advance_recovery);
      if (recovery > 0) {
        const openRes = await client.query(
          `SELECT id, amount, recovered_amount
             FROM salary_advances
            WHERE agency_id = $1 AND guard_id = $2 AND status = 'outstanding'
            ORDER BY recorded_at ASC FOR UPDATE`,
          [agencyId, guardId],
        );
        let remaining = recovery;
        for (const adv of openRes.rows) {
          if (remaining <= 0) break;
          const outstanding = toMoney(adv.amount) - toMoney(adv.recovered_amount);
          if (outstanding <= 0) continue;
          const apply = round2(Math.min(remaining, outstanding));
          const newRecovered = round2(toMoney(adv.recovered_amount) + apply);
          const fullyRecovered = newRecovered >= toMoney(adv.amount);
          await client.query(
            `UPDATE salary_advances
                SET recovered_amount = $1,
                    status = $2,
                    recovered_at = $3
              WHERE id = $4`,
            [
              newRecovered,
              fullyRecovered ? 'recovered' : 'outstanding',
              fullyRecovered ? new Date() : null,
              adv.id,
            ],
          );
          remaining = round2(remaining - apply);
        }
      }

      await client.query('COMMIT');
      return { record: withNumbers(updated.rows[0]) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Record a salary advance. Validated server-side; a positive amount is
   * required. The advance starts outstanding and is later recovered by payroll.
   */
  static async createAdvance({ agencyId, guardId, amount, reason }) {
    const guardRes = await pool.query(
      `SELECT id FROM guards WHERE id = $1 AND agency_id = $2`,
      [guardId, agencyId],
    );
    if (!guardRes.rows.length) return { error: 'GUARD_NOT_FOUND' };

    const value = toMoney(amount);
    if (value <= 0) return { error: 'INVALID_AMOUNT' };

    const result = await pool.query(
      `INSERT INTO salary_advances (agency_id, guard_id, amount, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, amount, recovered_amount, reason, status, recorded_at`,
      [agencyId, guardId, value, reason ? String(reason).trim().slice(0, 255) : null],
    );
    const row = result.rows[0];
    return {
      advance: {
        ...row,
        id: Number(row.id),
        amount: toMoney(row.amount),
        recovered_amount: toMoney(row.recovered_amount),
        outstanding: toMoney(row.amount),
      },
    };
  }
}

module.exports = Payroll;
module.exports.isValidPeriod = isValidPeriod;
module.exports.MAX_AMOUNT = MAX_AMOUNT;