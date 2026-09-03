const express = require('express');
const router = express.Router();
const Client = require('../../data/models/Client');
const verifyToken = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload folder exists (creates it if missing)
const avatarDir = path.join(__dirname, '../../uploads/clients/avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    cb(null, `${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only image files allowed'), ok);
  }
});

router.post('/client/details', verifyToken, async (req, res) => {
  try {
    const { companyName, siteName, siteAddress, city, state, pincode } = req.body;

    if (!companyName || !siteName || !siteAddress || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: 'Pincode must be 6 digits' });
    }

    const client = await Client.create({
      userId: req.user.id,
      companyName,
      siteName,
      siteAddress,
      city,
      state,
      pincode
    });

    return res.status(201).json({ success: true, data: client });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.patch('/client/avatar', verifyToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }
    const avatarUrl = `/uploads/clients/avatars/${req.file.filename}`;
    const updated = await Client.updateAvatar(req.user.id, avatarUrl);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.patch('/client/avatar', verifyToken, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded' });
    }
    const avatarUrl = `/uploads/clients/avatars/${req.file.filename}`;
    const updated = await Client.updateAvatar(req.user.id, avatarUrl);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.get('/client/details', verifyToken, async (req, res) => {
  try {
    const client = await Client.findByUserId(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client details not found' });
    }
    return res.status(200).json({ success: true, data: client });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;