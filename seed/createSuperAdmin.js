require('dotenv').config();
const pool = require('../db');
const SuperAdmin = require('../data/models/SuperAdmin');

async function seed() {
  try {
    const existing = await SuperAdmin.findByAccountId('u-superadmin');
    if (existing) {
      console.log('Super admin already exists. Skipping.');
      return;
    }

const admin = await SuperAdmin.create({
  account_id: 'u-superadmin',
  full_name: 'Vikram Chauhan',
  mobile_number: '+919000000001',
  email: 'super@sentry.com',
  password: process.env.SUPERADMIN_PASSWORD || 'ChangeMe@123',
  account_type: 'superAdmin',   
});

    console.log('Super admin created:', admin);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

seed();
