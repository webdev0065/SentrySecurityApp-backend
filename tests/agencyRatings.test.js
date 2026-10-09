/**
 * GET /api/agency/ratings - end-to-end DB + API tests.
 *
 * Covers the agency dashboard's Client Reviews source:
 *   - only agency-level client ratings (guard_id IS NULL) are averaged
 *   - the agency identity comes from the session (cross-agency isolation)
 *   - auth: unauthenticated, non-agency, and profile-less agency rejected
 *
 * Harness: same pattern as payroll.test.js - snapshots the live schema with
 * pg_dump, seeds an isolated database, boots the real Express server on its
 * own port, and drives it over HTTP.
 *
 * Run from SentrySecurityApp-backend:
 *   node --test tests/agencyRatings.test.js
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
const TEST_DB = 'sentry_security_ratings_test';
const DB_HOST = process.env.DB_HOST || '/tmp';
const DB_USER = process.env.DB_USER || 'devansh';
const DB_PORT = Number(process.env.DB_PORT || 5432);
const PORT = Number(process.env.RATINGS_TEST_PORT || 3481);
const JWT_SECRET = 'ratings-test-secret';
const BASE = `http://127.0.0.1:${PORT}`;

let pool = null;
let server = null;
let serverLog = '';
let dumpFile = null;

const ctx = {
  agencyAUserId: null,
  agencyBUserId: null,
  profilelessAgencyUserId: null,
  guardUserA: null,
  guardA: null,
  agencyAId: null,
  agencyBId: null,
  tokenA: null,
  tokenB: null,
  tokenProfileless: null,
  tokenGuard: null,
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

const insertAgency = async (client, userId) =>
  (
    await client.query(
      `INSERT INTO agencies (user_id, agency_name, business_type, office_address, city, state, pincode, district, status)
       VALUES ($1, 'Ratings Services', 'private_security', '1 Test Street', 'Mumbai', 'Maharashtra', '400001', 'Mumbai', 'approved')
       RETURNING id`,
      [userId],
    )
  ).rows[0].id;

const insertClient = async (client, userId, companyName) =>
  (
    await client.query(
      `INSERT INTO clients (user_id, company_name, site_name, site_address, city, state, pincode)
       VALUES ($1, $2, 'Main Office', '1 Test Road', 'Mumbai', 'Maharashtra', '400001')
       RETURNING id`,
      [userId, companyName],
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

    ctx.agencyAUserId = await insertUser(client, 'Agency A', '+919810000001', 'a@ratings.test', 'agency');
    ctx.agencyBUserId = await insertUser(client, 'Agency B', '+919810000002', 'b@ratings.test', 'agency');
    // Signed-in agency account with no agencies row → endpoint must 404.
    ctx.profilelessAgencyUserId = await insertUser(client, 'No Profile', '+919810000003', 'np@ratings.test', 'agency');
    ctx.guardUserA = await insertUser(client, 'Guard One', '+919810000011', 'g1@ratings.test', 'guard');
    const clientUser1 = await insertUser(client, 'Client One', '+919810000021', 'c1@ratings.test', 'client');
    const clientUser2 = await insertUser(client, 'Client Two', '+919810000022', 'c2@ratings.test', 'client');

    ctx.agencyAId = await insertAgency(client, ctx.agencyAUserId);
    ctx.agencyBId = await insertAgency(client, ctx.agencyBUserId);

    const client1 = await insertClient(client, clientUser1, 'Client One Pvt Ltd');
    const client2 = await insertClient(client, clientUser2, 'Client Two Pvt Ltd');

    // Guard needed as the target of a guard-level rating (must be excluded
    // from the agency-wide summary).
    ctx.guardA = (
      await client.query(
        `INSERT INTO guards (user_id, agency_id, basic_salary, allowances, shift_hours, status)
         VALUES ($1, $2, 25000, 1000, 8, 'off_duty') RETURNING id`,
        [ctx.guardUserA, ctx.agencyAId],
      )
    ).rows[0].id;

    // Agency A: client1 rates 5, client2 rates 4 → agency avg 4.5 (count 2).
    await client.query(
      `INSERT INTO client_ratings (client_id, agency_id, rating, comment) VALUES ($1, $2, 5, 'Excellent')`,
      [client1, ctx.agencyAId],
    );
    await client.query(
      `INSERT INTO client_ratings (client_id, agency_id, rating, comment) VALUES ($1, $2, 4, 'Good')`,
      [client2, ctx.agencyAId],
    );
    // Guard-level rating for agency A — must NOT count towards the agency card.
    await client.query(
      `INSERT INTO client_ratings (client_id, agency_id, guard_id, rating, comment) VALUES ($1, $2, $3, 1, 'Guard issue')`,
      [client1, ctx.agencyAId, ctx.guardA],
    );
    // Agency B: client1 rates 2 → its own isolated summary.
    await client.query(
      `INSERT INTO client_ratings (client_id, agency_id, rating, comment) VALUES ($1, $2, 2, 'Needs work')`,
      [client1, ctx.agencyBId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  ctx.tokenA = jwt.sign({ id: ctx.agencyAUserId, account_type: 'agency' }, JWT_SECRET, { expiresIn: '1h' });
  ctx.tokenB = jwt.sign({ id: ctx.agencyBUserId, account_type: 'agency' }, JWT_SECRET, { expiresIn: '1h' });
  ctx.tokenProfileless = jwt.sign(
    { id: ctx.profilelessAgencyUserId, account_type: 'agency' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
  ctx.tokenGuard = jwt.sign({ id: ctx.guardUserA, account_type: 'guard' }, JWT_SECRET, { expiresIn: '1h' });
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

async function api(method, pathname, { token } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body: payload };
}

test('agency ratings summary', async (t) => {
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

  await t.test('1. unauthenticated request is rejected', async () => {
    const res = await api('GET', '/api/agency/ratings');
    assert.equal(res.status, 401);
  });

  await t.test('2. non-agency users are rejected', async () => {
    const res = await api('GET', '/api/agency/ratings', { token: ctx.tokenGuard });
    assert.equal(res.status, 403);
  });

  await t.test('3. agency account without profile is rejected', async () => {
    // verifyToken already blocks unapproved/profile-less agency accounts with
    // AGENCY_APPROVAL_REQUIRED before any route runs.
    const res = await api('GET', '/api/agency/ratings', { token: ctx.tokenProfileless });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'AGENCY_APPROVAL_REQUIRED');
  });

  await t.test('4. summary averages agency-level ratings only', async () => {
    const res = await api('GET', '/api/agency/ratings', { token: ctx.tokenA });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    // (5 + 4) / 2 = 4.5 — the guard-level rating of 1 is excluded.
    assert.equal(Number(res.body.data.average_rating), 4.5);
    assert.equal(res.body.data.rating_count, 2);
  });

  await t.test('5. another agency sees only its own ratings', async () => {
    const res = await api('GET', '/api/agency/ratings', { token: ctx.tokenB });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.data.average_rating), 2);
    assert.equal(res.body.data.rating_count, 1);
  });

  await t.test('6. agency with no reviews reports empty, not fabricated data', async () => {
    const client = await pool.connect();
    let userId;
    try {
      userId = await insertUser(client, 'Agency C', '+919810000004', 'c@ratings.test', 'agency');
      await insertAgency(client, userId);
    } finally {
      client.release();
    }
    const token = jwt.sign({ id: userId, account_type: 'agency' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await api('GET', '/api/agency/ratings', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.rating_count, 0);
    assert.equal(res.body.data.average_rating, null, 'no reviews → null average, not 0');
  });
});

