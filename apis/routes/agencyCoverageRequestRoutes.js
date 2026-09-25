const express = require('express');
const router = express.Router();
const pool = require('../../db');
const Agency = require('../../data/models/Agency');
const CoverageRequest = require('../../data/models/CoverageRequest');
const Site = require('../../data/models/Site');
const Subscription = require('../../data/models/Subscription');
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
      const uniqueGuardIds = [...new Set(guardIds.map(Number))].filter(
        Number.isInteger,
      );
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

    const updated = await CoverageRequest.updateForAgency(
      request.id,
      agency.id,
      status,
      assignedGuardIds,
    );
    const site =
      status === 'approved'
        ? await Site.createFromCoverageRequest({
            agencyId: req.user.id,
            request,
          })
        : null;
    if (status === 'assigned') {
      const linkedSite = await pool.query(
        'SELECT id FROM sites WHERE source_coverage_request_id = $1',
        [request.id],
      );
      if (!linkedSite.rows[0]) {
        return res.status(409).json({
          success: false,
          message: 'Approve this request before assigning guards',
        });
      }
      await pool.query(
        'UPDATE guards SET site_id = $1 WHERE agency_id = $2 AND id = ANY($3::int[])',
        [linkedSite.rows[0].id, req.user.id, assignedGuardIds],
      );
    }
    return res.json({ success: true, data: updated, site });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
