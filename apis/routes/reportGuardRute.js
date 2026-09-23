const express = require('express');
const router = express.Router();
const Guard = require('../../data/models/Guard');
const Incident = require('../../data/models/Incident');
const Notification = require('../../data/models/Notification');
const Agency = require('../../data/models/Agency');
const pool = require('../../db');
const verifyToken = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

router.post('/guard/reports', verifyToken, upload.array('photos', 5), async (req, res) => {
  try {
    if (req.user.account_type !== 'guard') {
      return res.status(403).json({ success: false, message: 'Guard access is required' });
    }
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

    const agency = await Agency.findByUserId(guard.agency_id);
    if (!agency) {
      return res.status(404).json({ success: false, message: 'Assigned agency not found' });
    }

    await Notification.createForRecipient({
      recipientId: agency.id,
      recipientType: 'agency',
      type: 'INCIDENT_REPORTED',
      title: `New ${severity} severity incident`,
      message: `${guard.full_name} reported an incident at ${guard.site_name}.`,
      referenceType: 'incident',
      referenceId: incident.id,
      targetRole: 'agency',
    });

    const clientResult = await pool.query(
      `SELECT cr.client_id
       FROM sites s
       JOIN coverage_requests cr ON cr.id = s.source_coverage_request_id
       WHERE s.id = $1`,
      [guard.site_id],
    );
    // Looked up for future use; client is intentionally NOT notified here.
    // Client alerts appear only after the 15-minute escalation window.
    void clientResult.rows[0]?.client_id;

    const { scheduleIncidentSoundReminders } = require('../../jobs/notificationSoundScheduler');
    scheduleIncidentSoundReminders(incident.id);

    return res.status(201).json({ success: true, data: incident });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/guard/reports', verifyToken, async (req, res) => {
  try {
    if (req.user.account_type !== 'guard') {
      return res.status(403).json({ success: false, message: 'Guard access is required' });
    }
    const incidents = await Incident.findByGuardUserId(req.user.id);
    return res.status(200).json({ success: true, data: incidents });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
