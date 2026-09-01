const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getAuth } = require('firebase-admin/auth');
require('../../config/firebaseAdmin'); // Firebase app initialize karne ke liye
const User = require('../../data/models/User');

// ===== Existing Login (email/mobile + password) =====
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res
      .status(400)
      .json({ error: 'Email/Mobile and password are required' });
  }

  try {
    const user = await User.findByEmailOrMobileForLogin(identifier);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, account_type: user.account_type },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        account_type: user.account_type,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== NEW: Firebase OTP Verify (Phone Login/Register) =====
router.post('/verify-firebase-otp', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  try {
    // Step 1: Firebase token verify karo
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const mobile_number = decodedToken.phone_number;
    const firebase_uid = decodedToken.uid;

    // Step 2: DB mein number check karo
    let user = await User.findByPhoneNumber(mobile_number);

    // Step 3: Agar user nahi mila, naya bana do
    if (!user) {
      user = await User.createFromPhone(mobile_number, firebase_uid);
    }

    // Step 4: Apna JWT token generate karo
    const token = jwt.sign(
      { id: user.id, mobile_number, account_type: user.account_type },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );

    res.json({
      message: 'OTP verified, login successful',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        mobile_number,
        account_type: user.account_type,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Invalid or expired OTP token' });
  }
});

module.exports = router;
