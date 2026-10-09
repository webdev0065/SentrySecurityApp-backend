/**
 * Agency Payroll Management - end-to-end DB + API tests.
 *
 * Covers the payroll calculation rule and the financial operations:
 *   gross = basic + overtime + allowances
 *   net   = gross - deductions - advance_recovery
 *
 * Harness: same pattern as assignmentIntegrity.test.js - snapshots the live
 * schema with pg_dump, seeds an isolated database, boots the real Express
 * server on its own port, and drives it over HTTP.
 *
 * Run from SentrySecurityApp-backend:
 *   node --test tests/payroll.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SOURCE_DB = process.env.TEST_SOURCE_DB || 'sentry_security';
const TEST_DB = 'sentry_security_payroll_test';
const DB_HOST = process.env.DB_HOST || '/tmp';
const DB_USER = process.env.DB_USER || 'devansh';
const DB_PORT = Number(process.env.DB_PORT || 5432);
const PORT = Number(process.env.TEST_PORT || 3479);
const JWT_SECRET = 'payroll-test-secret';
const BASE = `http://127.0.0.1:${PORT}`;

let pool = null;
let server = null;
let serverLog = '';
let dumpFile = null;

const ctx = {
  agencyUserId: null,
  guardUserA: null,
  guardA: null,
  guardB: null,
  otherAgencyUserId: null,
  otherGuardUser: null,
  otherGuard: null,
  agencyToken: null,
  otherAgencyToken: null,
  guardToken: null,
  period: '2026-05-01',
};

function psql(database, args) {
  execFileSync(
    'psql',
    ['-h', DB_HOST, '-U', DB_USER, '-d', database, '-v', 'ON_ERROR_STOP=1', ...args],
    { stdio: 'pipe' },
  );
}

const insertUser = async (client, name, mobile, email, type) =>
  (
    await client.query(
      `INSERT INTO users (full_name, mobile_number, email, password, account_type)
       VALUES ($1, $2, $3, 'not-a-real-hash', $4) RETURNING id`,
      [name, mobile, email, type],
    )
  ).rows[0].id;

const insertGuard = async (client, agencyId, userId, basicSalary, allowances) =>
  (
    await client.query(
      `INSERT INTO guards (user_id, agency_id, basic_salary, allowances, shift_hours, status)
       VALUES ($1, $2, $3, $4, 8, 'off_duty') RETURNING id`,
      [userId, agencyId, basicSalary, allowances],
    )
  ).rows[0].id;

before(async () => {
  dumpFile = path.join(os.tmpdir(), `${TEST_DB}-schema.sql`);
  fs.writeFileSync(
    dumpFile,
    execFileSync('pg_dump', ['--schema-only', '--no-owner', '-h', DB_HOST, '-U', DB_USER, SOURCE_DB]),
  );
  psql('postgres', ['-tAc', `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`]);
  psql('postgres', ['-tAc', `CREATE DATABASE ${TEST_DB}`]);
  psql(TEST_DB, ['-f', dumpFile]);

  pool = new Pool({ host: DB_HOST, user: DB_USER, port: DB_PORT, database: TEST_DB });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    ctx.agencyUserId = await insertUser(client, 'Payroll Agency', '+919800000001', 'agency@payroll.test', 'agency');
    ctx.otherAgencyUserId = await insertUser(client, 'Other Agency', '+919800000002', 'other@payroll.test', 'agency');
    ctx.guardUserA = await insertUser(client, 'Rohan Mehta', '+919800000011', 'ga@payroll.test', 'guard');
    const guardUserB = await insertUser(client, 'Amit Kaur', '+919800000012', 'gb@payroll.test', 'guard');
    ctx.otherGuardUser = await insertUser(client, 'Outsider', '+919800000013', 'gc@payroll.test', 'guard');

    for (const uid of [ctx.agencyUserId, ctx.otherAgencyUserId]) {
      await client.query(
        `INSERT INTO agencies (user_id, agency_name, business_type, office_address, city, state, pincode, district, status)
         VALUES ($1, 'Payroll Services', 'private_security', '1 Test Street', 'Mumbai', 'Maharashtra', '400001', 'Mumbai', 'approved')`,
        [uid],
      );
    }

    ctx.guardA = await insertGuard(client, ctx.agencyUserId, ctx.guardUserA, 25000, 1000);
    ctx.guardB = await insertGuard(client, ctx.agencyUserId, guardUserB, 24000, 1000);
    ctx.otherGuard = await insertGuard(client, ctx.otherAgencyUserId, ctx.otherGuardUser, 50000, 0);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  ctx.agencyToken = jwt.sign({ id: ctx.agencyUserId, account_type: 'agency' }, JWT_SECRET, { expiresIn: '1h' });
  ctx.otherAgencyToken = jwt.sign({ id: ctx.otherAgencyUserId, account_type: 'agency' }, JWT_SECRET, { expiresIn: '1h' });
  ctx.guardToken = jwt.sign({ id: ctx.guardUserA, account_type: 'guard' }, JWT_SECRET, { expiresIn: '1h' });
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise((resolve) => server.once('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    if (!exited) server.kill('SIGKILL');
  }
  if (pool) await pool.end().catch(() => {});
  if (dumpFile) fs.rmSync(dumpFile, { force: true });
  try {
    psql('postgres', ['-tAc', `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`]);
  } catch { /* best effort */ }
});

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: payload };
}

test('payroll feature', async (t) => {
  await t.test('0. boots the server', async () => {
    server = spawn(process.execPath, ['index.js'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        DB_HOST, DB_USER, DB_PORT: String(DB_PORT),
        DB_PASSWORD: process.env.DB_PASSWORD || '',
        DB_NAME: TEST_DB,
        JWT_SECRET,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (c) => { serverLog += c; });
    server.stderr.on('data', (c) => { serverLog += c; });
    const deadline = Date.now() + 30000;
    let healthy = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { const r = await fetch(`${BASE}/health`); if (r.ok) { healthy = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(healthy, `server failed to start:\n${serverLog}`);
  });

  await t.test('1. overview is agency-scoped and period-filtered', async () => {
    const res = await api('GET', `/api/agency/payroll?period=${ctx.period}`, { token: ctx.agencyToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.rows.length, 2, 'only this agency’s guards');
    const names = res.body.data.rows.map((r) => r.full_name).sort();
    assert.deepEqual(names, ['Amit Kaur', 'Rohan Mehta']);
    assert.equal(res.body.data.summary.pending, 2);
  });

  await t.test('2. save computes server-authoritative net salary', async () => {
    // 25000 + 1000 + 1000 - 1400 = 25600
    const res = await api('POST', `/api/agency/payroll/${ctx.guardA}`, {
      token: ctx.agencyToken,
      body: { period: ctx.period, basic_salary: 25000, overtime: 1000, allowances: 1000, deductions: 1400 },
    });
    assert.equal(res.status, 200);
    const rec = res.body.data.record;
    assert.equal(Number(rec.net_salary), 25600, 'gross - deductions');
    assert.equal(rec.status, 'pending', 'save does not mark paid');
  });

  await t.test('3. client-supplied net salary is ignored (server authoritative)', async () => {
    const res = await api('POST', `/api/agency/payroll/${ctx.guardA}`, {
      token: ctx.agencyToken,
      body: { period: ctx.period, basic_salary: 25000, overtime: 0, allowances: 1000, deductions: 0, net_salary: 1 },
    });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.data.record.net_salary), 26000, 'recomputed, not 1');
  });

  await t.test('4. editing updates the single record (no duplicates)', async () => {
    const count = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM payroll_records WHERE guard_id = $1 AND period = $2',
      [ctx.guardA, ctx.period],
    )).rows[0].n;
    assert.equal(count, 1, 'one record per guard per period');
  });

  await t.test('5. summary totals match the saved rows', async () => {
    const res = await api('GET', `/api/agency/payroll?period=${ctx.period}`, { token: ctx.agencyToken });
    const total = Number(res.body.data.summary.total);
    // Rohan saved 26000, Amit not generated → basic 24000 + allowances 1000 = 25000
    assert.equal(total, 51000);
    assert.equal(res.body.data.summary.pending, 2);
    assert.equal(res.body.data.summary.verified, 0);
  });

  await t.test('6. advance recorded and surfaces outstanding balance', async () => {
    const res = await api('POST', `/api/agency/payroll/${ctx.guardA}/advances`, {
      token: ctx.agencyToken,
      body: { amount: 3000, reason: 'Emergency' },
    });
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.data.advance.outstanding), 3000);
    const det = await api('GET', `/api/agency/payroll/${ctx.guardA}?period=${ctx.period}`, { token: ctx.agencyToken });
    assert.equal(Number(det.body.data.outstanding_advance.outstanding), 3000);
  });

  await t.test('7. advance recovery reduces net salary when saved', async () => {
    const res = await api('POST', `/api/agency/payroll/${ctx.guardA}`, {
      token: ctx.agencyToken,
      body: { period: ctx.period, basic_salary: 25000, overtime: 0, allowances: 1000, deductions: 0 },
    });
    // gross 26000 - advance_recovery 3000 = 23000
    assert.equal(Number(res.body.data.record.net_salary), 23000);
    assert.equal(Number(res.body.data.record.advance_recovery), 3000);
  });

  await t.test('8. mark as paid recovers the advance exactly once', async () => {
    const pay = await api('POST', `/api/agency/payroll/${ctx.guardA}/pay`, {
      token: ctx.agencyToken,
      body: { period: ctx.period },
    });
    assert.equal(pay.status, 200);
    assert.equal(pay.body.data.record.status, 'paid');
    assert.ok(pay.body.data.record.paid_at, 'paid_at set');
    const adv = (await pool.query(
      'SELECT amount, recovered_amount, status FROM salary_advances WHERE guard_id = $1',
      [ctx.guardA],
    )).rows[0];
    assert.equal(Number(adv.recovered_amount), 3000, 'advance fully recovered');
    assert.equal(adv.status, 'recovered');
  });

  await t.test('9. duplicate payment is rejected (idempotent, no double pay)', async () => {
    const pay = await api('POST', `/api/agency/payroll/${ctx.guardA}/pay`, {
      token: ctx.agencyToken,
      body: { period: ctx.period },
    });
    assert.equal(pay.status, 409);
    assert.equal(pay.body.code, 'PAYROLL_ALREADY_PAID');
    // Advance stays recovered once (no double recovery).
    const adv = (await pool.query(
      'SELECT recovered_amount FROM salary_advances WHERE guard_id = $1',
      [ctx.guardA],
    )).rows[0];
    assert.equal(Number(adv.recovered_amount), 3000);
  });

  await t.test('10. paid record is locked against edits', async () => {
    const res = await api('POST', `/api/agency/payroll/${ctx.guardA}`, {
      token: ctx.agencyToken,
      body: { period: ctx.period, basic_salary: 99999, overtime: 0, allowances: 0, deductions: 0 },
    });
    assert.equal(res.status, 409, 'cannot edit a paid record');
  });

  await t.test('11. cross-agency access denied', async () => {
    const det = await api('GET', `/api/agency/payroll/${ctx.otherGuard}?period=${ctx.period}`, { token: ctx.agencyToken });
    assert.equal(det.status, 404, 'another agency’s guard is invisible');
    const save = await api('POST', `/api/agency/payroll/${ctx.otherGuard}`, {
      token: ctx.agencyToken,
      body: { period: ctx.period, basic_salary: 1, overtime: 0, allowances: 0, deductions: 0 },
    });
    assert.equal(save.status, 404, 'cannot save another agency’s guard');
    // The other agency's own overview must not leak this agency's guards.
    const other = await api('GET', `/api/agency/payroll?period=${ctx.period}`, { token: ctx.otherAgencyToken });
    assert.equal(other.body.data.rows.length, 1);
    assert.equal(other.body.data.rows[0].full_name, 'Outsider');
  });

  await t.test('12. non-agency users are rejected', async () => {
    const res = await api('GET', `/api/agency/payroll?period=${ctx.period}`, { token: ctx.guardToken });
    assert.equal(res.status, 403);
  });

  await t.test('13. invalid monetary input is rejected', async () => {
    const res = await api('POST', `/api/agency/payroll/${ctx.guardB}`, {
      token: ctx.agencyToken,
      body: { period: ctx.period, basic_salary: -5, overtime: 0, allowances: 0, deductions: 0 },
    });
    assert.equal(res.status, 400);
  });

  await t.test('14. advance with zero amount is rejected', async () => {
    const res = await api('POST', `/api/agency/payroll/${ctx.guardB}/advances`, {
      token: ctx.agencyToken,
      body: { amount: 0 },
    });
    assert.equal(res.status, 400);
  });

  await t.test('15. invalid period is rejected', async () => {
    const res = await api('GET', '/api/agency/payroll?period=2026-13', { token: ctx.agencyToken });
    assert.equal(res.status, 400);
  });
});

