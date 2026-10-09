const express = require('express');
const router = express.Router();
const Payroll = require('../../data/models/Payroll');
const verifyToken = require('../middleware/authMiddleware');

// All payroll endpoints require a signed-in agency with an approved account.
router.use(verifyToken);
router.use((req, res, next) => {
  if (req.user.account_type !== 'agency') {
    return res.status(403).json({ success: false, message: 'Agency access is required' });
  }
  next();
});

const AGENCY_ERRORS = {
  GUARD_NOT_FOUND: { status: 404, message: 'Guard not found for this agency' },
  ALREADY_PAID: { status: 409, code: 'PAYROLL_ALREADY_PAID', message: 'This payroll has already been paid and cannot be changed.' },
  NOT_FOUND: { status: 404, code: 'PAYROLL_NOT_FOUND', message: 'Save the salary before marking it as paid.' },
  INVALID_AMOUNT: { status: 400, message: 'Advance amount must be greater than zero.' },
};

const fail = (res, error) => {
  const meta = AGENCY_ERRORS[error] || { status: 500, message: 'Server error' };
  return res.status(meta.status).json({ success: false, code: meta.code, message: meta.message });
};

const parseComponent = value => {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

/**
 * GET /agency/payroll?period=YYYY-MM-01
 * Overview: summary cards + guard-wise rows for the selected month. Both are
 * derived from the same query so the totals and the list always agree.
 */
router.get('/payroll', async (req, res) => {
  try {
    const { period } = req.query;
    if (!Payroll.isValidPeriod(period)) {
      return res.status(400).json({ success: false, message: 'period must be a valid month (YYYY-MM-01)' });
    }
    const rows = await Payroll.findOverviewByPeriod(req.user.id, period);
    const summary = Payroll.summarize(rows);
    return res.status(200).json({ success: true, data: { period, summary, rows } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /agency/payroll/:guardId?period=YYYY-MM-01
 * Details: guard context, saved record (if any), outstanding advance balance
 * and full advance history. Missing salary configuration is surfaced so the
 * UI can show the right validation message instead of inventing a value.
 */
router.get('/payroll/:guardId', async (req, res) => {
  try {
    const { period } = req.query;
    const guardId = Number(req.params.guardId);
    if (!Number.isInteger(guardId) || !Payroll.isValidPeriod(period)) {
      return res.status(400).json({ success: false, message: 'guardId and a valid period (YYYY-MM-01) are required' });
    }
    const guard = await Payroll.getGuardContext(req.user.id, guardId);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found for this agency' });
    }
    const [record, advances, outstanding] = await Promise.all([
      Payroll.getRecord(req.user.id, guardId, period),
      Payroll.findAdvances(req.user.id, guardId),
      Payroll.outstandingAdvance(req.user.id, guardId),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        period,
        guard,
        record: record || null,
        // Not persisted yet → preview the configured base pay so the agency
        // can generate payroll. No record is created just by opening details.
        defaults: {
          basic_salary: record ? record.basic_salary : guard.basic_salary,
          overtime: record ? record.overtime : 0,
          allowances: record ? record.allowances : guard.allowances,
          deductions: record ? record.deductions : 0,
        },
        salary_configured: guard.basic_salary > 0,
        advances,
        outstanding_advance: outstanding,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /agency/payroll/:guardId
 * Save (create/update) the salary components for a guard + period. The server
 * validates the amounts, recomputes the net salary and returns the persisted
 * record. Never marks the payroll as paid.
 */
router.post('/payroll/:guardId', async (req, res) => {
  try {
    const guardId = Number(req.params.guardId);
    const { period, basic_salary, overtime, allowances, deductions } = req.body || {};
    if (!Number.isInteger(guardId) || !Payroll.isValidPeriod(period)) {
      return res.status(400).json({ success: false, message: 'guardId and a valid period (YYYY-MM-01) are required' });
    }
    const components = {
      basic_salary: parseComponent(basic_salary),
      overtime: parseComponent(overtime),
      allowances: parseComponent(allowances),
      deductions: parseComponent(deductions),
    };
    if (Object.values(components).some(v => Number.isNaN(v) || v > Payroll.MAX_AMOUNT)) {
      return res.status(400).json({ success: false, message: 'Amounts must be valid non-negative numbers.' });
    }

    const result = await Payroll.save({ agencyId: req.user.id, guardId, period, components });
    if (result.error) return fail(res, result.error);
    return res.status(200).json({ success: true, data: { record: result.record } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /agency/payroll/:guardId/pay
 * Mark the guard's payroll for the period as paid (records that the agency
 * paid the guard externally). Idempotent and transaction-safe; recovers the
 * covered advances exactly once.
 */
router.post('/payroll/:guardId/pay', async (req, res) => {
  try {
    const guardId = Number(req.params.guardId);
    const { period } = req.body || {};
    if (!Number.isInteger(guardId) || !Payroll.isValidPeriod(period)) {
      return res.status(400).json({ success: false, message: 'guardId and a valid period (YYYY-MM-01) are required' });
    }
    const result = await Payroll.markPaid({ agencyId: req.user.id, guardId, period });
    if (result.error) return fail(res, result.error);
    return res.status(200).json({ success: true, data: { record: result.record } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /agency/payroll/:guardId/advances
 * Record a salary advance for the guard. Validated server-side; a positive
 * amount is required and the optional reason is capped at 255 chars.
 */
router.post('/payroll/:guardId/advances', async (req, res) => {
  try {
    const guardId = Number(req.params.guardId);
    const { amount, reason } = req.body || {};
    if (!Number.isInteger(guardId)) {
      return res.status(400).json({ success: false, message: 'guardId is required' });
    }
    if (amount === undefined || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Advance amount must be greater than zero.' });
    }
    const result = await Payroll.createAdvance({ agencyId: req.user.id, guardId, amount, reason });
    if (result.error) return fail(res, result.error);
    return res.status(201).json({ success: true, data: { advance: result.advance } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
