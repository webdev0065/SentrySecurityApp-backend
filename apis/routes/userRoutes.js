const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../db');

const router = express.Router();

router.post('/complete-registration', async (req, res) => {
  const { otp, mobile_number, full_name, email, password, account_type, profile } = req.body;
  if (!otp || !mobile_number || !full_name || !email || !password || !account_type || !profile) {
    return res.status(400).json({ error: 'Registration details and OTP are required' });
  }
  if (!/^\d{6}$/.test(String(otp))) {
    return res.status(400).json({ error: 'Enter any 6-digit OTP to continue in development mode' });
  }
  if (!['agency', 'client'].includes(account_type)) {
    return res.status(400).json({ error: 'Invalid account type' });
  }

  let client;
  try {
    const normalizedMobile = `+91${String(mobile_number).replace(/\D/g, '').slice(-10)}`;
    if (normalizedMobile.length !== 13) return res.status(400).json({ error: 'A valid mobile number is required' });

    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1 OR mobile_number = $2',
      [email.trim().toLowerCase(), normalizedMobile]
    );
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email or mobile number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (full_name, mobile_number, email, password, account_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, mobile_number, email, account_type`,
      [full_name.trim(), normalizedMobile, email.trim().toLowerCase(), hashedPassword, account_type]
    );
    const user = userResult.rows[0];

    if (account_type === 'agency') {
      const { agencyName, businessType, gstNumber, officeAddress, city, state, pincode } = profile;
      if (!agencyName || !businessType || !officeAddress || !city || !state || !/^\d{6}$/.test(pincode || '')) {
        throw new Error('Invalid agency details');
      }
      await client.query(
        `INSERT INTO agencies (user_id, agency_name, business_type, gst_number, office_address, city, state, pincode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [user.id, agencyName, businessType, gstNumber || null, officeAddress, city, state, pincode]
      );
    } else {
      const { companyName, siteName, siteAddress, city, state, pincode } = profile;
      if (!companyName || !siteName || !siteAddress || !city || !state || !/^\d{6}$/.test(pincode || '')) {
        throw new Error('Invalid client details');
      }
      await client.query(
        `INSERT INTO clients (user_id, company_name, site_name, site_address, city, state, pincode)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user.id, companyName, siteName, siteAddress, city, state, pincode]
      );
    }

    await client.query('COMMIT');
    const token = jwt.sign(
      { id: user.id, email: user.email, account_type: user.account_type },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.status(201).json({ message: 'Account created successfully', token, user });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    console.error(error);
    const message = ['Invalid agency details', 'Invalid client details'].includes(error.message)
      ? error.message
      : 'Could not complete registration';
    return res.status(400).json({ error: message });
  } finally {
    client?.release();
  }
});

module.exports = router;
