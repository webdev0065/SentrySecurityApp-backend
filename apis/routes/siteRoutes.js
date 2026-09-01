const express = require('express');
const router = express.Router();
const axios = require('axios'); 
const Site = require('../../data/models/Site');
const verifyToken = require('../middleware/authMiddleware');
const VALID_COVERAGE_PLANS = ['day_shift', 'night_watch', '24x7'];

async function geocodeAddress(address) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: address, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'SentrySecurityApp' }
    });
    if (response.data.length > 0) {
      return { latitude: parseFloat(response.data[0].lat), longitude: parseFloat(response.data[0].lon) };
    }
    return { latitude: null, longitude: null };
  } catch (err) {
    console.error('Geocoding failed:', err.message);
    return { latitude: null, longitude: null };
  }
}

router.post('/sites', verifyToken, async (req, res) => {
  try {
    let { siteName, siteAddress, city, state, latitude, longitude, coveragePlan, startTime, endTime } = req.body;

    if (!siteName) {
      return res.status(400).json({ success: false, message: 'siteName is required' });
    }
    if (coveragePlan && !VALID_COVERAGE_PLANS.includes(coveragePlan)) {
      return res.status(400).json({ success: false, message: 'coveragePlan must be day_shift, night_watch or 24x7' });
    }

    if ((!latitude || !longitude) && siteAddress) {
      const geo = await geocodeAddress(`${siteAddress}, ${city || ''}, ${state || ''}`);
      latitude = geo.latitude;
      longitude = geo.longitude;
    }

    const site = await Site.create({
      agencyId: req.user.id, siteName, siteAddress, city, state,
      latitude, longitude, coveragePlan, startTime, endTime
    });

    return res.status(201).json({ success: true, data: site });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/sites', verifyToken, async (req, res) => {
  try {
    const sites = await Site.findByAgencyId(req.user.id);
    return res.status(200).json({ success: true, data: sites });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;