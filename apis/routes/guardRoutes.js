const express = require('express');
const router = express.Router();
const Guard = require('../../data/models/Guard');
const Site = require('../../data/models/Site');
const verifyToken = require('../middleware/authMiddleware');

const VALID_COVERAGE_PLANS = ['day_shift', 'night_watch', '24x7'];
const VALID_STATUSES = ['on_duty', 'off_duty'];

function normalizeMobile(mobile) {
  const digits = String(mobile).replace(/\D/g, '');
  return `+91${digits.slice(-10)}`;
}

router.post('/guards', verifyToken, async (req, res) => {
  try {
    const { fullName, mobileNumber, siteId, coveragePlan, startTime, endTime, basicSalary, allowances } = req.body;

    if (!fullName || !mobileNumber) {
      return res.status(400).json({ success: false, message: 'fullName and mobileNumber are required' });
    }
    if (coveragePlan && !VALID_COVERAGE_PLANS.includes(coveragePlan)) {
      return res.status(400).json({ success: false, message: 'coveragePlan must be day_shift, night_watch or 24x7' });
    }

    const normalizedMobile = normalizeMobile(mobileNumber);
    if (normalizedMobile.length !== 13) {
      return res.status(400).json({ success: false, message: 'A valid 10-digit mobile number is required' });
    }

    if (siteId) {
      const site = await Site.findById(siteId, req.user.id);
      if (!site) {
        return res.status(404).json({ success: false, message: 'Site not found' });
      }
    }

    const guard = await Guard.create({
      agencyId: req.user.id,
      fullName,
      mobileNumber: normalizedMobile,
      siteId,
      coveragePlan,
      startTime,
      endTime,
      basicSalary,
      allowances
    });

    return res.status(201).json({ success: true, data: { ...guard, guard_code: `SG-${guard.id}` } });
  } catch (err) {
    if (err.code === '23505') { 
      return res.status(409).json({ success: false, message: 'Mobile number already registered' });
    }
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/guards', verifyToken, async (req, res) => {
  try {
    const guards = await Guard.findByAgencyId(req.user.id);
    const data = guards.map(g => ({ ...g, guard_code: `SG-${g.id}` }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/guards/:id', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findById(req.params.id, req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    return res.status(200).json({ success: true, data: { ...guard, guard_code: `SG-${guard.id}` } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch('/guards/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be on_duty or off_duty' });
    }
    const guard = await Guard.updateStatus(req.params.id, req.user.id, status);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    return res.status(200).json({ success: true, data: guard });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch('/guards/:id/location', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'latitude and longitude are required' });
    }
    const guard = await Guard.updateLocation(req.params.id, req.user.id, latitude, longitude);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    return res.status(200).json({ success: true, data: guard });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;