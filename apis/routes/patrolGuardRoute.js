const express = require('express');
const router = express.Router();
const Patrol = require('../../data/models/Patrol');
const Guard = require('../../data/models/Guard');
const verifyToken = require('../middleware/authMiddleware');

router.get('/patrol/checkpoints', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (!guard.site_id) {
      return res.status(400).json({ success: false, message: 'No active site assignment' });
    }

    const checkpoints = await Patrol.findCheckpointsBySiteId(guard.site_id);
    return res.status(200).json({
      success: true,
      data: { site_id: guard.site_id, site_name: guard.site_name, checkpoints }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/patrol/rounds/start', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }
    if (!guard.site_id) {
      return res.status(400).json({ success: false, message: 'No active site assignment' });
    }

    const existing = await Patrol.findActiveRound(guard.id);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A patrol round is already in progress',
        data: existing
      });
    }

    const checkpoints = await Patrol.findCheckpointsBySiteId(guard.site_id);
    if (checkpoints.length === 0) {
      return res.status(400).json({ success: false, message: 'No checkpoints configured for this site' });
    }

    const round = await Patrol.startRound({
      guardId: guard.id,
      siteId: guard.site_id,
      agencyId: guard.agency_id,
      totalCheckpoints: checkpoints.length
    });

    return res.status(201).json({ success: true, data: { ...round, checkpoints } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/patrol/rounds/active', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const round = await Patrol.findActiveRound(guard.id);
    if (!round) {
      return res.status(200).json({ success: true, data: null, message: 'No active round' });
    }

    const checkpoints = await Patrol.findCheckpointsBySiteId(round.site_id);
    const scans = await Patrol.findScansByRoundId(round.id);
    const scannedIds = scans.map(s => s.checkpoint_id);

    const checkpointStatus = checkpoints.map(c => ({
      ...c,
      scanned: scannedIds.includes(c.id),
      scanned_at: scans.find(s => s.checkpoint_id === c.id)?.scanned_at || null
    }));

    const nextCheckpoint = checkpointStatus.find(c => !c.scanned) || null;

    return res.status(200).json({
      success: true,
      data: {
        round,
        progress: {
          scanned: round.scanned_count,
          total: round.total_checkpoints,
          percent: Math.round((round.scanned_count / round.total_checkpoints) * 100)
        },
        next_checkpoint: nextCheckpoint,
        checkpoints: checkpointStatus
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/patrol/checkpoints/:id/scan', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const round = await Patrol.findActiveRound(guard.id);
    if (!round) {
      return res.status(400).json({ success: false, message: 'No active patrol round. Start a round first.' });
    }

    const checkpoint = await Patrol.findCheckpointById(req.params.id);
    if (!checkpoint) {
      return res.status(404).json({ success: false, message: 'Checkpoint not found' });
    }
    if (checkpoint.site_id !== round.site_id) {
      return res.status(400).json({ success: false, message: 'Checkpoint does not belong to your assigned site' });
    }

    const result = await Patrol.scanCheckpoint({
      roundId: round.id,
      checkpointId: checkpoint.id,
      guardId: guard.id
    });

    if (result.alreadyScanned) {
      return res.status(409).json({ success: false, message: 'Checkpoint already scanned in this round' });
    }

    return res.status(201).json({
      success: true,
      data: {
        scan: result.scan,
        progress: {
          scanned: result.round.scanned_count,
          total: result.round.total_checkpoints,
          percent: Math.round((result.round.scanned_count / result.round.total_checkpoints) * 100)
        },
        round_completed: result.completed
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/patrol/rounds', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const rounds = await Patrol.findRoundsByGuardId(guard.id);
    return res.status(200).json({ success: true, data: rounds });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/patrol/rounds/:id', verifyToken, async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const round = await Patrol.findRoundById(req.params.id);
    if (!round || round.guard_id !== guard.id) {
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