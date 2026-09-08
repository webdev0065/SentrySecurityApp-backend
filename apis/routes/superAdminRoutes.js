const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { uploadProfilePhoto } = require('../middleware/upload');
const SuperAdmin = require('../../data/models/SuperAdmin');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res
      .status(400)
      .json({ error: 'Email/Mobile and password are required' });
  }

  try {
    const admin = await SuperAdmin.findByEmail(identifier);

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, account_type: 'superAdmin' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: admin.id,
        full_name: admin.full_name,
        email: admin.email,
        account_type: 'superAdmin',
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

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