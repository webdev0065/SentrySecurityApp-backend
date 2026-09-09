const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getAuth } = require('firebase-admin/auth');
require('../../config/firebaseAdmin'); 
const User = require('../../data/models/User');
const SuperAdmin = require('../../data/models/SuperAdmin');
const pool = require('../../db');

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    // 1. Pehle SuperAdmin table mein check karo
    const admin = await SuperAdmin.findByEmail(email);
    if (admin) {
      const isMatch = await bcrypt.compare(password, admin.password);
      if (isMatch) {
        const token = jwt.sign(
          { id: admin.id, account_id: admin.account_id, account_type: 'superAdmin' },
          process.env.JWT_SECRET,
          { expiresIn: '1d' }
        );
        return res.json({
          success: true,
          token,
          user: { id: admin.id, full_name: admin.full_name, email: admin.email, account_type: 'superAdmin' }
        });
      }
    }

    // 2. Agar Admin nahi hai, toh Users table mein check karo
    const userResult = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (isMatch) {
        if (user.account_type === 'agency') {
          const agency = await pool.query('SELECT status FROM agencies WHERE user_id = $1', [user.id]);
          if (agency.rows[0]?.status !== 'approved') {
            return res.status(403).json({ error: agency.rows[0]?.status === 'inactive' ? 'Your agency account is inactive. Contact the Super Admin to reactivate it.' : 'Your agency account is awaiting Super Admin approval. You can log in once approved.', code: 'AGENCY_APPROVAL_REQUIRED' });
          }
        }
        const token = jwt.sign(
          { id: user.id, mobile_number: user.mobile_number, account_type: user.account_type },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );
        return res.json({
          success: true,
          token,
          user: {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            mobile_number: user.mobile_number,
            account_type: user.account_type
          }
        });
      }
    }

    // Agar kahin match nahi hua
    return res.status(401).json({ success: false, error: 'Invalid email or password' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/verify-firebase-otp', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const mobile_number = decodedToken.phone_number;
    const firebase_uid = decodedToken.uid;

    let user = await User.findByPhoneNumber(mobile_number);

    if (!user) {
      user = await User.createFromPhone(mobile_number, firebase_uid);
    }

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

router.post('/register-with-otp', async (req, res) => {
  try {
    const { otp, mobile_number, full_name, email, password, account_type, profile } = req.body;

    if (otp !== "123456") {
      return res.status(400).json({ success: false, error: 'Invalid OTP, use 123456' });
    }

    if (!mobile_number || !email || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userResult = await pool.query(
      `INSERT INTO users (full_name, email, mobile_number, password, account_type) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, mobile_number, account_type`,
      [full_name, email, mobile_number, hashedPassword, account_type || 'client']
    );
    const user = userResult.rows[0];

    const token = jwt.sign(
      { id: user.id, mobile_number: user.mobile_number, account_type: user.account_type },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      token,
      user,
      profile: profile || null
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
