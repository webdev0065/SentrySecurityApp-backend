const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { uploadProfilePhoto } = require('../middleware/upload');
const SuperAdmin = require('../../data/models/SuperAdmin');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/account', authMiddleware, async (req, res) => {
  try {
    const admin = await SuperAdmin.findByAccountId(req.user.account_id);
    if (!admin) return res.status(404).json({ error: 'Not found' });
    delete admin.password;
    res.json(admin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/account', authMiddleware, uploadProfilePhoto.single('profilePhoto'), async (req, res) => {
  try {
    const { full_name, email, mobile_number } = req.body;

    const updated = await SuperAdmin.updateProfile(req.user.id, {
      full_name,
      email,
      mobile_number
    });

    if (req.file) {
      await SuperAdmin.updateProfilePhoto(req.user.id, `/uploads/profile-photos/${req.file.filename}`);
    }

    res.json({ success: true, admin: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;