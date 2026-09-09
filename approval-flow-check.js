// Local integration check. Creates one uniquely named agency and removes it in finally.
require('dotenv').config();
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api', require('./apis/routes/userRoutes'));
  app.use('/api', require('./apis/routes/authRoutes'));
  app.use('/api/superadmin', require('./apis/routes/agencyApprovalRoutes'));
  app.use('/api', require('./apis/routes/notificationRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const suffix = Date.now().toString();
  const email = `approval-check-${suffix}@example.invalid`;
  let userId;
  let agencyId;
  const request = async (path, method = 'GET', body, token) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const password = require('node:crypto').randomBytes(24).toString('hex');
    const created = await request('/complete-registration', 'POST', {
      otp: '123456', mobile_number: '+919' + suffix.slice(-9), full_name: 'Approval integration check', email, password, account_type: 'agency',
      profile: { agencyName: `Approval check ${suffix}`, businessType: 'Proprietorship', officeAddress: 'Integration test address', city: 'Gurugram', district: 'Gurugram', state: 'Haryana', pincode: '122001' },
    });
    assert.equal(created.status, 201);
    userId = created.data.user.id;
    assert.equal(created.data.approval_status, 'pending');
    assert.equal(created.data.token, undefined);
    const row = await pool.query('SELECT id FROM agencies WHERE user_id=$1', [userId]);
    agencyId = row.rows[0].id;
    assert.equal((await request('/login', 'POST', { email, password })).status, 403);
    const adminToken = jwt.sign({ id: 0, account_type: 'superAdmin' }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const agencyToken = jwt.sign({ id: userId, account_type: 'agency' }, process.env.JWT_SECRET, { expiresIn: '1m' });
    assert.equal((await request(`/superadmin/agencies/${agencyId}/approve`, 'PUT', undefined, agencyToken)).status, 403);
    const notifications = await request('/notifications', 'GET', undefined, adminToken);
    assert.equal(notifications.status, 200);
    assert.ok(notifications.data.some(item => item.reference_id === agencyId));
    assert.equal((await request(`/superadmin/agencies/${agencyId}/approve`, 'PUT', undefined, adminToken)).status, 200);
    const login = await request('/login', 'POST', { email, password });
    assert.equal(login.status, 200);
    assert.ok(login.data.token);
    const editedPassword = require('node:crypto').randomBytes(24).toString('hex');
    const edit = { ownerName: 'Updated test owner', agencyName: 'Updated test agency', email, mobile: '+919' + suffix.slice(-9), address: 'Updated integration address', state: 'Haryana', district: 'Gurugram', city: 'Gurugram', pincode: '122002', gstNumber: '', status: 'active', newPassword: editedPassword };
    assert.equal((await request(`/superadmin/agencies/${agencyId}`, 'PUT', edit, login.data.token)).status, 403);
    assert.equal((await request(`/superadmin/agencies/${agencyId}`, 'PUT', { ...edit, email: 'invalid' }, adminToken)).status, 400);
    assert.equal((await request(`/superadmin/agencies/${agencyId}`, 'PUT', edit, adminToken)).status, 200);
    const saved = await request(`/superadmin/agencies/${agencyId}`, 'GET', undefined, adminToken);
    assert.equal(saved.data.agency_name, edit.agencyName);
    assert.equal(saved.data.full_name, edit.ownerName);
    assert.equal(saved.data.pincode, edit.pincode);
    assert.equal((await request('/login', 'POST', { email, password: editedPassword })).status, 200);
    assert.equal((await request(`/superadmin/agencies/${agencyId}`, 'PUT', { ...edit, status: 'inactive', newPassword: '' }, adminToken)).status, 200);
    assert.equal((await request('/login', 'POST', { email, password: editedPassword })).status, 403);
    assert.equal((await request(`/superadmin/agencies/${agencyId}`, 'PUT', { ...edit, newPassword: '' }, adminToken)).status, 200);
    assert.equal((await request(`/superadmin/agencies/${agencyId}/approve`, 'PUT', undefined, login.data.token)).status, 403);
    const remaining = await pool.query("SELECT id FROM notifications WHERE reference_type='agency' AND reference_id=$1", [agencyId]);
    assert.equal(remaining.rowCount, 0);
    assert.equal((await request(`/superadmin/agencies/${agencyId}/reject`, 'PUT', undefined, adminToken)).status, 200);
    assert.equal((await request('/login', 'POST', { email, password: editedPassword })).status, 403);
    console.log('PASS: approval flow, validated agency editing, password update, deactivation, reactivation, role protection and rejection.');
  } finally {
    if (agencyId) await pool.query("DELETE FROM notifications WHERE reference_type='agency' AND reference_id=$1", [agencyId]);
    if (userId) await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [userId, email]);
    server.close();
    await pool.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
