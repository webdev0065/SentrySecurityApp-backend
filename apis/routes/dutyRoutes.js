const express = require('express');
const router = express.Router();
const Duty = require('../../data/models/Duty');
const Guard = require('../../data/models/Guard');
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

router.post('/duty/clock-in', verifyToken, uploadDutyPhoto, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (!guard.site_id) {
      return res.status(400).json({ success: false, message: 'No active site assignment' });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'A guard photo is required to start duty'
      });
    }

    const existing = await Duty.findActiveLog(guard.id);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Already clocked in',
        data: existing
      });
    }

    const log = await Duty.clockIn({
      guardId: guard.id,
      siteId: guard.site_id,
      agencyId: guard.agency_id,
      photoUrl: dutyPhotoUrl(req.file)
    });

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

    const existing = await Duty.findActiveLog(guard.id);
    if (!existing) {
      return res.status(400).json({ success: false, message: 'Not currently clocked in' });
    }

    const log = await Duty.clockOut(existing.id, guard.id, dutyPhotoUrl(req.file));

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