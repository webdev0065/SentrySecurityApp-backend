const express = require('express');
const router = express.Router();
const Guard = require('../../data/models/Guard');
const Incident = require('../../data/models/Incident');
const Notification = require('../../data/models/Notification');
const verifyToken = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

router.post('/guard/reports', verifyToken, upload.array('photos', 5), async (req, res) => {
  try {
    const { severity, notes } = req.body;
    const validSeverities = ['low', 'medium', 'high'];

    if (!validSeverities.includes(severity)) {
      return res
        .status(400)
        .json({ success: false, message: 'severity must be low, medium or high' });
    }
    if (!notes || !notes.trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'notes describing the incident is required' });
    }

    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (!guard.site_id) {
      return res
        .status(400)
        .json({ success: false, message: 'No active site assignment' });
    }

    const incident = await Incident.create({
      agencyId: guard.agency_id,
      siteId: guard.site_id,
      severity,
      notes,
      guardId: guard.id,
    });

    if (req.files && req.files.length > 0) {
      const imageUrls = req.files.map(f => f.path);
      await Incident.addImages(incident.id, imageUrls);
    }

    await Notification.create({
      type: 'INCIDENT_REPORTED',
      title: `New ${severity} severity incident`,
      message: `${guard.full_name} reported an incident at ${guard.site_name}.`,
      referenceType: 'incident',
      referenceId: incident.id,
      targetRole: 'agency',
      targetId: guard.agency_id,
    });

    return res.status(201).json({ success: true, data: incident });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/guard/reports', verifyToken, async (req, res) => {
  try {
    const incidents = await Incident.findByGuardUserId(req.user.id);
    return res.status(200).json({ success: true, data: incidents });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;