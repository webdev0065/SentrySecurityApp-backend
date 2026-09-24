const express = require('express');
const router = express.Router();
const Duty = require('../../data/models/Duty');
const Guard = require('../../data/models/Guard');
const verifyToken = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

router.get('/duty/status', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const activeLog = await Duty.findActiveLog(guard.id);

    return res.status(200).json({
      success: true,
      data: {
        status: activeLog ? 'on_duty' : 'off_duty',
        active_log: activeLog || null,
        assignment: guard.site_id
          ? { site_id: guard.site_id, site_name: guard.site_name }
          : null
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/duty/clock-in', verifyToken, upload.single('photo'), async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (!guard.site_id) {
      return res.status(400).json({ success: false, message: 'No active site assignment' });
    }

    const existing = await Duty.findActiveLog(guard.id);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Already clocked in',
        data: existing
      });
    }

    const photoUrl = req.file ? req.file.path : null;

    const log = await Duty.clockIn({
      guardId: guard.id,
      siteId: guard.site_id,
      agencyId: guard.agency_id,
      photoUrl
    });

    return res.status(201).json({ success: true, data: log });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/duty/clock-out', verifyToken, upload.single('photo'), async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const existing = await Duty.findActiveLog(guard.id);
    if (!existing) {
      return res.status(400).json({ success: false, message: 'Not currently clocked in' });
    }

    const photoUrl = req.file ? req.file.path : null;

    const log = await Duty.clockOut(existing.id, guard.id, photoUrl);

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