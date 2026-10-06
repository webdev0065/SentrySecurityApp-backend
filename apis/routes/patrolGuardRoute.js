const express = require('express');
const router = express.Router();
const Patrol = require('../../data/models/Patrol');
const Guard = require('../../data/models/Guard');
const Duty = require('../../data/models/Duty');
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

    // Completion belongs to the duty session, not to the checkpoint: visits
    // are only counted for the guard's active session, and with no active
    // session every checkpoint comes back unvisited for the next duty.
    const activeDutyLog = await Duty.findActiveLog(guard.id);
    const [checkpoints, recentScans] = await Promise.all([
      Patrol.findCheckpointsWithVisitsBySiteId(
        guard.site_id,
        guard.id,
        activeDutyLog ? activeDutyLog.id : null
      ),
      Patrol.findRecentScansBySiteIdForGuard(guard.id, guard.site_id)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        site_id: guard.site_id,
        site_name: guard.site_name,
        checkpoints,
        recent_scans: recentScans
      }
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

    // Rounds exist only inside a duty session: there is nothing to start
    // while the guard is off duty.
    const activeDutyLog = await Duty.findActiveLog(guard.id);
    if (!activeDutyLog) {
      return res.status(403).json({
        success: false,
        message: 'You are not on duty. Start your duty to complete checkpoints.',
        code: 'DUTY_NOT_ACTIVE'
      });
    }

    const existing = await Patrol.findActiveRound(guard.id, activeDutyLog.id);
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
      totalCheckpoints: checkpoints.length,
      dutyLogId: activeDutyLog.id
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

    // Scoped to the active duty session: while off duty there is no active
    // round, and rounds of finished sessions are never returned.
    const activeDutyLog = await Duty.findActiveLog(guard.id);
    const round = await Patrol.findActiveRound(
      guard.id,
      activeDutyLog ? activeDutyLog.id : null
    );
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

    // Backend duty gate (non-negotiable): a completion is accepted only while
    // the guard genuinely has an active duty session. The client's timer/UI
    // state is never trusted — the duty_logs row is the source of truth.
    const activeDutyLog = await Duty.findActiveLog(guard.id);
    if (!activeDutyLog) {
      return res.status(403).json({
        success: false,
        message: 'You are not on duty. Start your duty to complete checkpoints.',
        code: 'DUTY_NOT_ACTIVE'
      });
    }
    if (!guard.site_id) {
      return res.status(400).json({ success: false, message: 'No active site assignment' });
    }

    const checkpoint = await Patrol.findCheckpointById(req.params.id);
    if (!checkpoint) {
      return res.status(404).json({ success: false, message: 'Checkpoint not found' });
    }
    if (checkpoint.site_id !== guard.site_id) {
      return res.status(400).json({ success: false, message: 'Checkpoint does not belong to your assigned site' });
    }

    // One completion per checkpoint per duty session: a repeat call reports
    // the existing visit instead of writing a duplicate record.
    const existingVisit = await Patrol.findScanInDutySession({
      guardId: guard.id,
      dutyLogId: activeDutyLog.id,
      checkpointId: checkpoint.id
    });
    if (existingVisit) {
      return res.status(409).json({
        success: false,
        message: 'Checkpoint already scanned in this duty session'
      });
    }

    // The round stores this duty session's scan history and is opened on
    // demand; rounds never carry completion into another duty session.
    let round = await Patrol.findActiveRound(guard.id, activeDutyLog.id);
    if (round && round.site_id !== guard.site_id) {
      // Reassigned mid-round: the stale round can no longer accept scans.
      await Patrol.completeRound(round.id);
      round = null;
    }
    if (!round) {
      const siteCheckpoints = await Patrol.findCheckpointsBySiteId(guard.site_id);
      if (siteCheckpoints.length === 0) {
        return res.status(400).json({ success: false, message: 'No checkpoints configured for this site' });
      }

      round = await Patrol.startRound({
        guardId: guard.id,
        siteId: guard.site_id,
        agencyId: guard.agency_id,
        totalCheckpoints: siteCheckpoints.length,
        dutyLogId: activeDutyLog.id
      });
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