const express = require('express');
const router = express.Router();
const Agency = require('../../data/models/Agency');
const verifyToken = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

router.post('/agency/profile-photo', verifyToken, (req, res, next) => {
  upload.uploadProfilePhoto.single('photo')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const photoUrl = `/uploads/profile-photos/${req.file.filename}`;
    const updatedAgency = await Agency.updateProfilePhoto(req.user.id, photoUrl);

    if (!updatedAgency) {
      return res.status(404).json({ success: false, message: 'Agency not found — create agency details first' });
    }

    return res.status(200).json({ success: true, data: updatedAgency });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/agency/profile-photo', verifyToken, async (req, res) => {
  try {
    const agency = await Agency.findByUserId(req.user.id);
    if (!agency || !agency.profile_photo_url) {
      return res.status(404).json({ success: false, message: 'No profile photo found' });
    }
    return res.status(200).json({ success: true, data: { profile_photo_url: agency.profile_photo_url } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;