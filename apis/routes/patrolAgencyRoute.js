const express = require('express');
const router = express.Router();
const Patrol = require('../../data/models/Patrol');
const Site = require('../../data/models/Site');
const verifyToken = require('../middleware/authMiddleware');

router.post('/sites/:siteId/checkpoints', verifyToken, async (req, res) => {
  try {
    const { name, sequenceOrder, latitude, longitude } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }

    const site = await Site.findById(req.params.siteId, req.user.id);
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    const checkpoint = await Patrol.createCheckpoint({
      siteId: site.id,
      name: name.trim(),
      sequenceOrder,
      latitude,
      longitude
    });

    return res.status(201).json({ success: true, data: checkpoint });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/sites/:siteId/checkpoints', verifyToken, async (req, res) => {
  try {
    const site = await Site.findById(req.params.siteId, req.user.id);
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    const checkpoints = await Patrol.findCheckpointsBySiteId(site.id);
    return res.status(200).json({ success: true, data: checkpoints });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});


router.put('/sites/:siteId/checkpoints/:id', verifyToken, async (req, res) => {
  try {
    const { name, sequenceOrder, latitude, longitude } = req.body;

    const site = await Site.findById(req.params.siteId, req.user.id);
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    const checkpoint = await Patrol.updateCheckpoint(req.params.id, site.id, {
      name,
      sequenceOrder,
      latitude,
      longitude
    });

    if (!checkpoint) {
      return res.status(404).json({ success: false, message: 'Checkpoint not found' });
    }

    return res.status(200).json({ success: true, data: checkpoint });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.delete('/sites/:siteId/checkpoints/:id', verifyToken, async (req, res) => {
  try {
    const site = await Site.findById(req.params.siteId, req.user.id);
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    const deleted = await Patrol.deleteCheckpoint(req.params.id, site.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Checkpoint not found' });
    }

    return res.status(200).json({ success: true, message: 'Checkpoint removed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/patrol/rounds', verifyToken, async (req, res) => {
  try {
    const rounds = await Patrol.findRoundsByAgencyId(req.user.id);
    return res.status(200).json({ success: true, data: rounds });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/patrol/rounds/:id', verifyToken, async (req, res) => {
  try {
    const round = await Patrol.findRoundById(req.params.id);
    if (!round || round.agency_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Round not found' });
    }

    const scans = await Patrol.findScansByRoundId(round.id);
    return res.status(200).json({ success: true, data: { ...round, scans } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;