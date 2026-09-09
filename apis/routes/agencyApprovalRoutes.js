const express = require('express');
const router = express.Router();
const Agency = require('../../data/models/Agency');
const Notification = require('../../data/models/Notification');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/agencies', authMiddleware, async (req, res) => {
  try {
    const agencies = await Agency.findAll({ status: req.query.status });
    res.json(agencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agencies/:id', authMiddleware, async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id);
    if (!agency) return res.status(404).json({ error: 'Not found' });
    res.json(agency);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/agencies/:id/approve', authMiddleware, async (req, res) => {
  try {
    const agency = await Agency.updateStatus(req.params.id, 'approved');
    if (!agency) return res.status(404).json({ error: 'Not found' });

    await Notification.deleteByReference('agency', agency.id);

    res.json({ success: true, agency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/agencies/:id/reject', authMiddleware, async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id);
    if (!agency) return res.status(404).json({ error: 'Not found' });

    await Agency.deleteById(req.params.id);
    await Notification.deleteByReference('agency', agency.id);

    res.json({ success: true, message: 'Agency rejected and removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;