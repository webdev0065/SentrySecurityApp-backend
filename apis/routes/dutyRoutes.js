const express = require('express');
const router = express.Router();
const Duty = require('../../data/models/Duty');
const Guard = require('../../data/models/Guard');
const Patrol = require('../../data/models/Patrol');
const verifyToken = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

// Guard photos are required evidence for a duty log, so surface multer
// validation problems as client errors instead of generic 500s.
const uploadDutyPhoto = (req, res, next) => {
  upload.uploadDutyPhoto.single('photo')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return next();
  });
};

const dutyPhotoUrl = (file) => (file ? `/uploads/duty/${file.filename}` : null);

// ---------------------------------------------------------------------------
// 24-hour duty cycle
//
// A guard may START one duty session per rolling 24 hours, anchored to the
// last clock-in timestamp (not the calendar date): next start is allowed at
// `last clock_in_at + 24h`. This keeps overnight shifts (e.g. 20:00 -> 06:00)
// intact — no midnight reset — because eligibility is only ever evaluated
// while the guard is OFF DUTY. Ending duty is gated by the state machine
// itself: only an active session can be clocked out.
// ---------------------------------------------------------------------------
const CYCLE_MS = 24 * 60 * 60 * 1000;

const cycleEligibility = (lastLog, now = new Date()) => {
  if (!lastLog) return { canStart: true, nextStartAt: null };
  const next = new Date(new Date(lastLog.clock_in_at).getTime() + CYCLE_MS);
  return next > now
    ? { canStart: false, nextStartAt: next.toISOString() }
    : { canStart: true, nextStartAt: null };
};

router.get('/duty/status', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const activeLog = await Duty.findActiveLog(guard.id);
    // Off duty, the latest log anchors the 24-hour cycle; on duty there is no
    // "next start" to report.
    const lastLog = activeLog ? null : await Duty.findLatestLog(guard.id);
    const eligibility = cycleEligibility(lastLog);

    return res.status(200).json({
      success: true,
      data: {
        status: activeLog ? 'on_duty' : 'off_duty',
        active_log: activeLog || null,
        assignment: guard.site_id
          ? { site_id: guard.site_id, site_name: guard.site_name }
          : null,
        // Backend-authoritative eligibility for the frontend to render UX
        // guards; enforcement happens on the clock-in/out endpoints below.
        can_start: !activeLog && eligibility.canStart,
        can_end: Boolean(activeLog),
        next_start_at: activeLog ? null : eligibility.nextStartAt
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});


router.post('/duty/clock-in', verifyToken, uploadDutyPhoto, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (!guard.site_id) {
      return res.status(400).json({ success: false, code: 'NO_SITE_ASSIGNMENT', message: 'No active site assignment' });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: 'DUTY_PHOTO_REQUIRED',
        message: 'A guard photo is required to start duty'
      });
    }

    // State machine: ON_DUTY -> ON_DUTY is never valid. Rejecting with the
    // existing session makes duplicate submissions (retries, double taps, lost
    // responses) safe instead of creating a second session.
    const existing = await Duty.findActiveLog(guard.id);
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'DUTY_ALREADY_ACTIVE',
        message: 'Already clocked in',
        data: existing
      });
    }

    // 24-hour duty cycle: timestamp-anchored, never calendar-based.
    const lastLog = await Duty.findLatestLog(guard.id);
    const eligibility = cycleEligibility(lastLog);
    if (!eligibility.canStart) {
      return res.status(409).json({
        success: false,
        code: 'DUTY_COOLING_DOWN',
        message: 'You have already started duty in the last 24 hours',
        next_start_at: eligibility.nextStartAt,
        data: lastLog
      });
    }

    let log;
    try {
      log = await Duty.clockIn({
        guardId: guard.id,
        siteId: guard.site_id,
        agencyId: guard.agency_id,
        photoUrl: dutyPhotoUrl(req.file)
      });
    } catch (err) {
      // duty_logs_single_active_per_guard: a concurrent clock-in won the race
      // between the check above and the insert. One succeeds, one is rejected.
      if (err && err.code === '23505') {
        const winner = await Duty.findActiveLog(guard.id);
        return res.status(409).json({
          success: false,
          code: 'DUTY_ALREADY_ACTIVE',
          message: 'Already clocked in',
          data: winner || null
        });
      }
      throw err;
    }


    // Keep the guard record in sync so agency dashboards show live duty status.
    await Guard.updateDutyStatusByUserId(guard.user_id, 'on_duty');

    return res.status(201).json({ success: true, data: log });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/duty/clock-out', verifyToken, uploadDutyPhoto, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: 'DUTY_PHOTO_REQUIRED',
        message: 'A guard photo is required to end duty'
      });
    }

    const existing = await Duty.findActiveLog(guard.id);
    if (!existing) {
      // Duplicate/late end request (lost response, retry, double tap): return
      // the already-ended state instead of creating anything. Clock-out is
      // idempotent by construction — the guarded UPDATE below can only ever
      // close a session once.
      const lastLog = await Duty.findLatestLog(guard.id);
      return res.status(409).json({
        success: false,
        code: 'DUTY_NOT_ACTIVE',
        message: 'Not currently clocked in',
        data: lastLog || null
      });
    }

    const log = await Duty.clockOut(existing.id, guard.id, dutyPhotoUrl(req.file));
    if (!log) {
      // A concurrent clock-out ended this session between check and update.
      const lastLog = await Duty.findLatestLog(guard.id);
      return res.status(409).json({
        success: false,
        code: 'DUTY_NOT_ACTIVE',
        message: 'Not currently clocked in',
        data: lastLog || null
      });
    }


    // The duty session is over: close its patrol round so no further checkpoint
    // completion can attach to it. Scan history rows are kept for reports.
    try {
      await Patrol.completeRoundsForDutyLog(existing.id);
    } catch (patrolErr) {
      console.error('Failed to close patrol rounds for duty log', existing.id, patrolErr);
    }

    await Guard.updateDutyStatusByUserId(guard.user_id, 'off_duty');

    return res.status(200).json({ success: true, data: log });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/duty/history', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const logs = await Duty.findByGuardId(guard.id);
    return res.status(200).json({ success: true, data: logs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/duty/salary', verifyToken, async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to dates (YYYY-MM-DD) are required' });
    }

    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (!guard.basic_salary || !guard.shift_hours) {
      return res.status(400).json({ success: false, message: 'Guard salary or shift hours not configured' });
    }

    const salary = await Duty.calculateSalary(
      guard.id,
      from,
      to,
      Number(guard.basic_salary),
      Number(guard.shift_hours)
    );

    return res.status(200).json({ success: true, data: salary });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;