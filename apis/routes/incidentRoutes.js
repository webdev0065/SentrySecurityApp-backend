const express = require('express');
const router = express.Router();
const Incident = require('../../data/models/Incident');
const Site = require('../../data/models/Site');
const verifyToken = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

const VALID_SEVERITIES = ['low', 'medium', 'high'];

router.post('/incidents', verifyToken, (req, res, next) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { siteId, severity, notes } = req.body;

    if (!siteId || !severity || !notes) {
      return res.status(400).json({ success: false, message: 'siteId, severity and notes are required' });
    }
    if (!VALID_SEVERITIES.includes(String(severity).toLowerCase())) {
      return res.status(400).json({ success: false, message: 'severity must be low, medium or high' });
    }

    const site = await Site.findById(siteId, req.user.id);
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    const incident = await Incident.create({
      agencyId: req.user.id,
      siteId,
      severity: severity.toLowerCase(),
      notes
    });

    let images = [];
    if (req.files && req.files.length > 0) {
      const imageUrls = req.files.map(file => `/uploads/incidents/${file.filename}`);
      images = await Incident.addImages(incident.id, imageUrls);
    }

    return res.status(201).json({
      success: true,
      data: { ...incident, incident_code: `INC-${incident.id}`, site_name: site.site_name, images }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/incidents', verifyToken, async (req, res) => {
  try {
    const incidents = await Incident.findByAgencyId(req.user.id);
    const data = await Promise.all(incidents.map(async (i) => ({
      ...i,
      incident_code: `INC-${i.id}`,
      images: await Incident.getImages(i.id)
    })));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/incidents/:id', verifyToken, async (req, res) => {
  try {
    const incident = await Incident.findById(req.params.id, req.user.id);
    if (!incident) {
      return res.status(404).json({ success: false, message: 'Incident not found' });
    }
    const images = await Incident.getImages(incident.id);
    return res.status(200).json({ success: true, data: { ...incident, incident_code: `INC-${incident.id}`, images } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/incidents/:id', verifyToken, (req, res, next) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { severity, notes } = req.body;

    const existing = await Incident.findById(req.params.id, req.user.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Incident not found' });
    }

    if (severity && !VALID_SEVERITIES.includes(String(severity).toLowerCase())) {
      return res.status(400).json({ success: false, message: 'severity must be low, medium or high' });
    }

    const updates = {};
    if (severity) updates.severity = severity.toLowerCase();
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length > 0) {
      await Incident.update(req.params.id, req.user.id, updates);
    }

    if (req.files && req.files.length > 0) {
      const imageUrls = req.files.map(file => `/uploads/incidents/${file.filename}`);
      await Incident.addImages(existing.id, imageUrls);
    }

    const updated = await Incident.findById(req.params.id, req.user.id);
    const images = await Incident.getImages(updated.id);

    return res.status(200).json({
      success: true,
      data: { ...updated, incident_code: `INC-${updated.id}`, images }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;