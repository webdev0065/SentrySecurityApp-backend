const express = require('express');
const router = express.Router();
const Plan = require('../../data/models/Plan');
const Subscription = require('../../data/models/Subscription');
const verifyToken = require('../middleware/authMiddleware');

// GET /api/plans - sabhi available plans (public, login zaroori nahi)
router.get('/plans', async (req, res) => {
  try {
    const plans = await Plan.findAll();
    return res.status(200).json({ success: true, data: plans });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/agency/subscription - agency ka current plan
router.get('/agency/subscription', verifyToken, async (req, res) => {
  try {
    if (req.user.account_type !== 'agency') {
      return res.status(403).json({ success: false, message: 'Agency access is required' });
    }

    const subscription = await Subscription.findActiveByAgencyId(req.user.id);
    if (!subscription) {
      return res.status(404).json({ success: false, message: 'No active subscription found' });
    }

    const guardCount = await Subscription.countGuards(req.user.id);
    const siteCount = await Subscription.countSites(req.user.id);

    return res.status(200).json({
      success: true,
      data: {
        ...subscription,
        usage: {
          guards: { used: guardCount, limit: subscription.max_guards },
          sites: { used: siteCount, limit: subscription.max_sites },
        },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/agency/subscription/switch - plan change karo
router.post('/agency/subscription/switch', verifyToken, async (req, res) => {
  try {
    if (req.user.account_type !== 'agency') {
      return res.status(403).json({ success: false, message: 'Agency access is required' });
    }

    const { planName } = req.body;
    if (!planName) {
      return res.status(400).json({ success: false, message: 'planName is required' });
    }

    const plan = await Plan.findByName(planName);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    // Agar downgrade kar rahe hain, check karo existing guards/sites naye plan ki limit se zyada toh nahi
    if (plan.max_guards !== null) {
      const guardCount = await Subscription.countGuards(req.user.id);
      if (guardCount > plan.max_guards) {
        return res.status(400).json({
          success: false,
          message: `Cannot switch to ${planName}. You currently have ${guardCount} guards, but this plan allows only ${plan.max_guards}.`,
        });
      }
    }
    if (plan.max_sites !== null) {
      const siteCount = await Subscription.countSites(req.user.id);
      if (siteCount > plan.max_sites) {
        return res.status(400).json({
          success: false,
          message: `Cannot switch to ${planName}. You currently have ${siteCount} sites, but this plan allows only ${plan.max_sites}.`,
        });
      }
    }

    const subscription = await Subscription.switchPlan(req.user.id, plan.id);
    return res.status(200).json({ success: true, data: { ...subscription, plan_name: plan.name } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;