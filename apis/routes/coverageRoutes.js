const express = require('express');
const router = express.Router();
const CoverageRequest = require('../../data/models/CoverageRequest');
const Client = require('../../data/models/Client');
const verifyToken = require('../middleware/authMiddleware');

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected', 'assigned', 'completed', 'cancelled'];

router.post('/coverage-request', verifyToken, async (req, res) => {
  try {
    const { eventName, state, district, city, pincode, siteLocation, guardsNeeded, notes } = req.body;

    if (!state || !district || !city || !pincode || !siteLocation) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Pincode must be 6 digits' });
    }
    const guards = Number(guardsNeeded) || 1;
    if (guards < 1) {
      return res.status(400).json({ success: false, message: 'guardsNeeded must be at least 1' });
    }

    const client = await Client.findByUserId(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    const request = await CoverageRequest.create({
      clientId: client.id,
      eventName: eventName || siteLocation,
      state,
      district,
      city,
      pincode,
      siteLocation,
      guardsNeeded: guards,
      notes: notes || null,
    });

    return res.status(201).json({ success: true, data: request });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/coverage-request', verifyToken, async (req, res) => {
  try {
    const client = await Client.findByUserId(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    const requests = await CoverageRequest.findByClientId(client.id);
    return res.status(200).json({ success: true, data: requests });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/coverage-request/:id', verifyToken, async (req, res) => {
  try {
    const client = await Client.findByUserId(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    const request = await CoverageRequest.findById(req.params.id, client.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    return res.status(200).json({ success: true, data: request });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/coverage-request/:id/status', verifyToken, async (req, res) => {
  try {
    const { status, assignedAgencyId } = req.body;

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const updated = await CoverageRequest.updateStatus(req.params.id, status, assignedAgencyId);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;