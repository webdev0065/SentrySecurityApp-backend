require('dotenv').config();
const pool = require('./db');

async function markMigrationAsRun() {
  try {
    const existing = await pool.query('SELECT * FROM pgmigrations ORDER BY run_on');
    console.log('Currently tracked migrations:');
    console.table(existing.rows);

    const check = await pool.query(
      `SELECT * FROM pgmigrations WHERE name = $1`,
      ['1787813980751_add-otp-columns-to-users']
    );

    if (check.rows.length > 0) {
      console.log('Migration already marked as run. Nothing to do.');
    } else {
      await pool.query(
        `INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())`,
        ['1787813980751_add-otp-columns-to-users']
      );
      console.log('Marked as run.');
    }

    const after = await pool.query('SELECT * FROM pgmigrations ORDER BY run_on');
    console.log('Tracked migrations after update:');
    console.table(after.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

markMigrationAsRun();
