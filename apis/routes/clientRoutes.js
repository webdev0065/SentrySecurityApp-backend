const express = require('express');
const router = express.Router();
const Client = require('../../data/models/Client');
const verifyToken = require('../middleware/authMiddleware');

router.post('/details', verifyToken, async (req, res) => {
  try {
    const { companyName, siteName, siteAddress, city, state, pincode } = req.body;

    if (!companyName || !siteName || !siteAddress || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Pincode must be 6 digits' });
    }

    const client = await Client.create({
      userId: req.user.id,
      companyName,
      siteName,
      siteAddress,
      city,
      state,
      pincode
    });

    return res.status(201).json({ success: true, data: client });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/details', verifyToken, async (req, res) => {
  try {
    const client = await Client.findByUserId(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client details not found' });
    }
    return res.status(200).json({ success: true, data: client });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;