const express = require('express');
const router = express.Router();
const pool = require('../../db');
const Agency = require('../../data/models/Agency');
const CoverageRequest = require('../../data/models/CoverageRequest');
const Site = require('../../data/models/Site');
const Patrol = require('../../data/models/Patrol');
const Subscription = require('../../data/models/Subscription');
const GuardAssignmentService = require('../../data/services/GuardAssignmentService');
const verifyToken = require('../middleware/authMiddleware');

const ALLOWED_STATUSES = ['approved', 'rejected', 'assigned', 'completed'];

async function getAgency(req, res) {
  if (req.user.account_type !== 'agency') {
    res.status(403).json({ success: false, message: 'Agency access required' });
    return null;
  }
  const agency = await Agency.findByUserId(req.user.id);
  if (!agency) {
    res
      .status(404)
      .json({ success: false, message: 'Agency profile not found' });
    return null;
  }
  return agency;
}

/**
 * Maps assignment business rules onto the shared `{ success, message, code }`
 * error contract. Returns true when the response has been sent.
 */
function sendAssignmentError(res, error) {
  if (error && error.name === 'AssignmentError') {
    res
      .status(error.status)
      .json({ success: false, message: error.message, code: error.code });
    return true;
  }
  return false;
}

router.get('/coverage-requests', verifyToken, async (req, res) => {
  try {
    const agency = await getAgency(req, res);
    if (!agency) return;
    const requests = await CoverageRequest.findByAgencyId(agency.id);
    return res.json({ success: true, data: requests });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/coverage-requests/:id', verifyToken, async (req, res) => {
  try {
    const agency = await getAgency(req, res);
    if (!agency) return;
    const request = await CoverageRequest.findForAgencyById(
      req.params.id,
      agency.id,
    );
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    }
    return res.json({ success: true, data: request });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/coverage-requests/:id', verifyToken, async (req, res) => {
  try {
    const agency = await getAgency(req, res);
    if (!agency) return;
    const { status, guardIds = [] } = req.body;
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${ALLOWED_STATUSES.join(', ')}`,
      });
    }

    const request = await CoverageRequest.findForAgencyById(
      req.params.id,
      agency.id,
    );
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: 'Request not found' });
    }

    let assignedGuardIds = null;
    if (status === 'assigned') {
      const uniqueGuardIds = GuardAssignmentService.normalizeGuardIds(guardIds);
      if (
        !uniqueGuardIds.length ||
        uniqueGuardIds.length > request.guards_needed
      ) {
        return res.status(400).json({
          success: false,
          message: `Select between 1 and ${request.guards_needed} guards`,
        });
      }
      const guards = await pool.query(
        'SELECT id FROM guards WHERE agency_id = $1 AND id = ANY($2::int[])',
        [req.user.id, uniqueGuardIds],
      );
      if (guards.rows.length !== uniqueGuardIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more selected guards are unavailable',
        });
      }
      assignedGuardIds = uniqueGuardIds;
    }

    if (status === 'approved') {
      // Approving a coverage request provisions a site for this agency, so the
      // plan's site allowance applies here too. Re-approving a request only
      // updates the site it already created and must not be blocked.
      const existingSite = await pool.query(
        'SELECT id FROM sites WHERE source_coverage_request_id = $1',
        [request.id],
      );
      if (!existingSite.rows.length) {
        const subscription = await Subscription.findActiveByAgencyId(
          req.user.id,
        );
        if (!subscription) {
          return res
            .status(403)
            .json({ success: false, message: 'No active subscription plan found' });
        }
        if (subscription.max_sites !== null) {
          const currentSiteCount = await Subscription.countSites(req.user.id);
          if (currentSiteCount >= subscription.max_sites) {
            return res.status(403).json({
              success: false,
              code: 'PLAN_LIMIT_REACHED',
              message: `Your ${subscription.plan_name} plan includes up to ${subscription.max_sites} sites, and you have reached this limit. Upgrade your plan to approve this request.`,
            });
          }
        }
      }
    }

    if (status === 'assigned') {
      // Single transaction: lock the request row (serializes concurrent
      // submissions of the same request), resolve the linked site, then run
      // the central assignment service which locks the guards and the site,
      // re-checks duplicate / already-assigned / capacity rules against the
      // locked rows, writes assignments, and only then persists the request
      // update. Nothing is mutated unless every rule passes.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(
          `SELECT id FROM coverage_requests
           WHERE id = $1 AND (selected_agency_id = $2 OR assigned_agency_id = $2)
           FOR UPDATE`,
          [request.id, agency.id],
        );
        if (!locked.rows[0]) {
          await client.query('ROLLBACK');
          return res
            .status(404)
            .json({ success: false, message: 'Request not found' });
        }
        const linkedSite = await client.query(
          'SELECT id FROM sites WHERE source_coverage_request_id = $1',
          [request.id],
        );
        if (!linkedSite.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'Approve this request before assigning guards',
            code: 'APPROVAL_REQUIRED',
          });
        }
        await GuardAssignmentService.assign(client, {
          agencyId: req.user.id,
          siteId: linkedSite.rows[0].id,
          guardIds: assignedGuardIds,
        });
        const updated = await CoverageRequest.updateForAgency(
          request.id,
          agency.id,
          status,
          assignedGuardIds,
          client,
        );
        await client.query('COMMIT');
        if (updated) {
          updated.checkpoints =
            await CoverageRequest.findCheckpointsByRequestId(request.id);
        }
        return res.json({ success: true, data: updated, site: null });
      } catch (assignmentError) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          // connection already unusable - surfaced by normalizeError below
        }
        throw GuardAssignmentService.normalizeError(assignmentError);
      } finally {
        client.release();
      }
    }

    const updated = await CoverageRequest.updateForAgency(
      request.id,
      agency.id,
      status,
      assignedGuardIds,
    );
    // Keep the response shape aligned with the list/detail endpoints so the
    // client can render the requested checkpoints without an extra fetch.
    if (updated) {
      updated.checkpoints = await CoverageRequest.findCheckpointsByRequestId(
        request.id,
      );
    }
    let site =
      status === 'approved'
        ? await Site.createFromCoverageRequest({
            agencyId: req.user.id,
            request,
          })
        : null;
    if (site && request.checkpoints?.length) {
      const existing = await Patrol.findCheckpointsBySiteId(site.id);
      if (!existing.length) {
        for (const point of request.checkpoints) {
          await Patrol.createCheckpoint({
            siteId: site.id,
            name: point.name,
            sequenceOrder: point.sequence_order,
          });
        }
      }
    }
    return res.json({ success: true, data: updated, site });
  } catch (error) {
    if (sendAssignmentError(res, error)) return;
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
