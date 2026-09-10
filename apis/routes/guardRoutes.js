const express = require('express');
const router = express.Router();
const Guard = require('../../data/models/Guard');
const Site = require('../../data/models/Site');
const verifyToken = require('../middleware/authMiddleware');

const VALID_COVERAGE_PLANS = ['day_shift', 'night_watch', '24x7'];
const VALID_SHIFT_HOURS = [8, 12];
const VALID_STATUSES = ['on_duty', 'off_duty'];
const VALID_GENDERS = ['male', 'female', 'other'];
const VALID_RATING_MIN = 1;
const VALID_RATING_MAX = 5;

function normalizeMobile(mobile) {
  const digits = String(mobile).replace(/\D/g, '');
  return `+91${digits.slice(-10)}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.post('/guards', verifyToken, async (req, res) => {
  try {
    const {
      fullName, mobileNumber, email, password, joiningDate,
      siteId, coveragePlan, shiftHours, startTime, endTime,
      basicSalary, allowances, address, age, gender
    } = req.body;

    if (!fullName || !mobileNumber || !email || !password || !joiningDate || !siteId || !coveragePlan || !basicSalary || !String(address || '').trim() || !gender) {
      return res.status(400).json({ success: false, message: 'All fields except age and allowances are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    if (coveragePlan && !VALID_COVERAGE_PLANS.includes(coveragePlan)) {
      return res.status(400).json({ success: false, message: 'coveragePlan must be day_shift, night_watch or 24x7' });
    }
    if (!isValidDate(joiningDate)) {
      return res.status(400).json({ success: false, message: 'joiningDate must be a valid date in YYYY-MM-DD format' });
    }
    if (Number(basicSalary) <= 0 || Number(basicSalary) > 99999999.99 || (allowances != null && (Number(allowances) < 0 || Number(allowances) > 99999999.99))) {
      return res.status(400).json({ success: false, message: 'basicSalary must be positive and allowances cannot be negative' });
    }
    if (coveragePlan !== '24x7') {
      if (!shiftHours || !VALID_SHIFT_HOURS.includes(Number(shiftHours))) {
        return res.status(400).json({ success: false, message: 'shiftHours must be 8 or 12 for day_shift/night_watch' });
      }
      if (!startTime || !endTime) {
        return res.status(400).json({ success: false, message: 'startTime and endTime are required for day_shift/night_watch' });
      }
    }
    if (!VALID_GENDERS.includes(gender)) {
      return res.status(400).json({ success: false, message: 'gender must be male, female or other' });
    }
    if (age != null && (isNaN(age) || age < 18 || age > 65)) {
      return res.status(400).json({ success: false, message: 'age must be a valid number between 18 and 65' });
    }

    const normalizedMobile = normalizeMobile(mobileNumber);
    if (!/^\+91[6-9]\d{9}$/.test(normalizedMobile)) {
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
      email,
      password,
      joiningDate,
      siteId,
      coveragePlan,
      shiftHours: coveragePlan === '24x7' ? null : Number(shiftHours),
      startTime,
      endTime,
      basicSalary,
      allowances,
      address,
      age,
      gender
    });

    return res.status(201).json({ success: true, data: { ...guard, guard_code: `SG-${guard.id}` } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Mobile number or email already registered' });
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

router.put('/guards/:id', verifyToken, async (req, res) => {
  try {
    const {
      siteId, coveragePlan, shiftHours, startTime, endTime,
      basicSalary, allowances, address, age, gender, rating
    } = req.body;

    if (coveragePlan && !VALID_COVERAGE_PLANS.includes(coveragePlan)) {
      return res.status(400).json({ success: false, message: 'coveragePlan must be day_shift, night_watch or 24x7' });
    }
    if (coveragePlan && coveragePlan !== '24x7') {
      if (!shiftHours || !VALID_SHIFT_HOURS.includes(Number(shiftHours))) {
        return res.status(400).json({ success: false, message: 'shiftHours must be 8 or 12 for day_shift/night_watch' });
      }
    }
    if (gender && !VALID_GENDERS.includes(gender)) {
      return res.status(400).json({ success: false, message: 'gender must be male, female or other' });
    }
    if (age != null && (isNaN(age) || age < 18 || age > 65)) {
      return res.status(400).json({ success: false, message: 'age must be a valid number between 18 and 65' });
    }
    if (rating != null && (isNaN(rating) || rating < VALID_RATING_MIN || rating > VALID_RATING_MAX)) {
      return res.status(400).json({ success: false, message: `rating must be a number between ${VALID_RATING_MIN} and ${VALID_RATING_MAX}` });
    }

    if (siteId) {
      const site = await Site.findById(siteId, req.user.id);
      if (!site) {
        return res.status(404).json({ success: false, message: 'Site not found' });
      }
    }

    const guard = await Guard.update(req.params.id, req.user.id, {
      siteId,
      coveragePlan,
      shiftHours: coveragePlan === '24x7' ? null : shiftHours,
      startTime,
      endTime,
      basicSalary,
      allowances,
      address,
      age,
      gender,
      rating
    });

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
