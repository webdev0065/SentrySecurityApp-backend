const express = require('express');
const router = express.Router();
const Agency = require('../../data/models/Agency');
const verifyToken = require('../middleware/authMiddleware');

router.post('/agency/details', verifyToken, async (req, res) => {
  try {
    const { agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode } = req.body;

    if (!agencyName || !businessType || !officeAddress || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Pincode must be 6 digits' });
    }

    const agency = await Agency.create({
      userId: req.user.id, agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode
    });

    return res.status(201).json({ success: true, data: agency });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/agency/details', verifyToken, async (req, res) => {
  try {
    const agency = await Agency.findByUserId(req.user.id);
    if (!agency) return res.status(404).json({ success: false, message: 'Agency details not found' });
    return res.status(200).json({ success: true, data: agency });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/agency/details', verifyToken, async (req, res) => {
  try {
    const { agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode } = req.body;

    if (!agencyName || !businessType || !officeAddress || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Pincode must be 6 digits' });
    }

    const agency = await Agency.update(req.user.id, { agencyName, businessType, gstNumber, officeAddress, city, state, district, pincode });

    if (!agency) {
      return res.status(404).json({ success: false, message: 'Agency details not found — create first' });
    }

    return res.status(200).json({ success: true, data: agency });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;