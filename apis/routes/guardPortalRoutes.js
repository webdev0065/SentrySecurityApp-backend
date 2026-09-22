const express = require('express');
const Guard = require('../../data/models/Guard');
const verifyToken = require('../middleware/authMiddleware');

const router = express.Router();

router.use(verifyToken);

router.use((req, res, next) => {
  if (req.user.account_type !== 'guard') {
    return res.status(403).json({ error: 'Guard access is required.' });
  }
  next();
});

router.get('/me', async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) return res.status(404).json({ error: 'Guard profile was not found.' });
    return res.json({ success: true, data: guard });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/profile', async (req, res) => {
  try {
    const { fullName, mobileNumber, email, address, age, gender } = req.body;
    if (
      !String(fullName || '').trim() ||
      !String(mobileNumber || '').trim() ||
      !String(email || '').trim()
    ) {
      return res
        .status(400)
        .json({ error: 'Name, mobile number and email are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (age != null && age !== '' && (isNaN(age) || age < 18 || age > 65)) {
      return res
        .status(400)
        .json({ error: 'age must be a valid number between 18 and 65.' });
    }
    if (gender && !['male', 'female', 'other'].includes(gender)) {
      return res
        .status(400)
        .json({ error: 'gender must be male, female or other.' });
    }
    const normalizedMobile = `+91${String(mobileNumber).replace(/\D/g, '').slice(-10)}`;
    if (!/^\+91[6-9]\d{9}$/.test(normalizedMobile)) {
      return res
        .status(400)
        .json({ error: 'A valid 10-digit mobile number is required.' });
    }

    const guard = await Guard.updateProfileByUserId(req.user.id, {
      fullName: String(fullName).trim(),
      mobileNumber: normalizedMobile,
      email: String(email).trim().toLowerCase(),
      address: address == null ? null : String(address).trim(),
      age: age == null || age === '' ? null : Number(age),
      gender: gender || null,
    });
    if (!guard) {
      return res.status(404).json({ error: 'Guard profile was not found.' });
    }
    return res.json({
      success: true,
      data: { ...guard, guard_code: `SG-${guard.id}` },
    });
  } catch (error) {
    if (error.code === '23505') {
      return res
        .status(409)
        .json({ error: 'Mobile number or email already registered' });
    }
    return res.status(500).json({ error: error.message });
  }
});

router.put('/duty', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['on_duty', 'off_duty'].includes(status)) {
      return res.status(400).json({ error: 'Duty status must be on_duty or off_duty.' });
    }
    const updated = await Guard.updateDutyStatusByUserId(req.user.id, status);
    if (!updated) return res.status(404).json({ error: 'Guard profile was not found.' });
    const guard = await Guard.findByUserId(req.user.id);
    return res.json({ success: true, data: guard });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
