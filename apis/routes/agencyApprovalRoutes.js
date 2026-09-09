const express = require('express');
const router = express.Router();
const Agency = require('../../data/models/Agency');
const Notification = require('../../data/models/Notification');
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../../db');
const bcrypt = require('bcrypt');
const { Buffer } = require('buffer');

router.use(authMiddleware, (req, res, next) => {
  if (req.user.account_type !== 'superAdmin') return res.status(403).json({ error: 'Super Admin access required' });
  next();
});

router.get('/agencies', authMiddleware, async (req, res) => {
  try {
    const agencies = await Agency.findAll({ status: req.query.status });
    res.json(agencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agencies/:id', authMiddleware, async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id);
    if (!agency) return res.status(404).json({ error: 'Not found' });
    res.json(agency);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/agencies/:id', async (req, res) => {
  const { ownerName, agencyName, email, mobile, address, state, district, city, pincode, gstNumber, status, newPassword } = req.body;
  if (![ownerName, agencyName, email, mobile, address, state, district, city, pincode].every(v => typeof v === 'string' && v.trim())) return res.status(400).json({ error: 'Complete all required agency details.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !/^\+91[6-9]\d{9}$/.test(mobile) || !/^[1-9]\d{5}$/.test(pincode)) return res.status(400).json({ error: 'Enter a valid email, Indian mobile number and pincode.' });
  if (!['active', 'inactive'].includes(status) || (gstNumber && !/^[A-Z0-9]{15}$/.test(gstNumber))) return res.status(400).json({ error: 'Invalid status or GST number.' });
  if (newPassword && (typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword) > 72)) return res.status(400).json({ error: 'Password must be 8–72 bytes.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT user_id, status FROM agencies WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!existing.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Agency not found.' }); }
    if (!['approved', 'inactive'].includes(existing.rows[0].status)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Review this agency in the Approval tab first.' }); }
    const userId = existing.rows[0].user_id;
    await client.query('UPDATE users SET full_name=$1, email=$2, mobile_number=$3 WHERE id=$4', [ownerName.trim(), email.trim().toLowerCase(), mobile, userId]);
    if (newPassword) await client.query('UPDATE users SET password=$1 WHERE id=$2', [await bcrypt.hash(newPassword, 10), userId]);
    await client.query('UPDATE agencies SET agency_name=$1, office_address=$2, state=$3, district=$4, city=$5, pincode=$6, gst_number=$7, status=$8 WHERE id=$9', [agencyName.trim(), address.trim(), state, district, city, pincode, gstNumber || null, status === 'active' ? 'approved' : 'inactive', req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'Email or mobile number already registered.' : 'Could not update agency.' });
  } finally { client.release(); }
});

router.put('/agencies/:id/approve', authMiddleware, async (req, res) => {
  try {
    const agency = await Agency.updateStatus(req.params.id, 'approved');
    if (!agency) return res.status(404).json({ error: 'Not found' });

    await Notification.deleteByReference('agency', agency.id);

    res.json({ success: true, agency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/agencies/:id/reject', authMiddleware, async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id);
    if (!agency) return res.status(404).json({ error: 'Not found' });

    await Agency.deleteById(req.params.id);
    await Notification.deleteByReference('agency', agency.id);

    res.json({ success: true, message: 'Agency rejected and removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
