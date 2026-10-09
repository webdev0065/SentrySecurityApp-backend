/**
 * 24-hour duty cycle + idempotent clock-in/out - end-to-end DB + API tests.
 *
 * Required scenarios (requirement 41, backend-executable subset):
 *  1. Eligible guard reads can_start=true from the status endpoint.
 *  2. Photo is mandatory for BOTH clock-in and clock-out.
 *  3. Eligible clock-in succeeds: ON DUTY, timer source, can_start=false.
 *  4. Duplicate clock-in (retry / double tap) -> 409 DUTY_ALREADY_ACTIVE with
 *     the existing session; never a second row.
 *  5. Clock-out succeeds: OFF DUTY, duration, guards.status mirrored.
 *  6. Duplicate clock-out (lost response / double tap) -> 409 DUTY_NOT_ACTIVE
 *     returning the already-ended session; exactly one end record.
 *  7. Clock-in before the 24-hour cycle completes -> 409 DUTY_COOLING_DOWN with
 *     next_start_at = last clock_in_at + 24h (timestamps, never calendar days).
 *  8. After 24h -> clock-in succeeds (fresh session), concurrent duplicates
 *     resolve to exactly one winner.
 *  9. Near-misses at 23h vs 25h prove rolling-timestamp semantics (a calendar
 *     rule would reset at midnight regardless of the clock_in hour).
 * 10. Overnight continuity: an active session whose clock_in_at was "yesterday
 *     evening" stays the SAME session (no midnight reset).
 * 11. Simultaneous clock-outs -> one 200 + one 409, one end record.
 *
 * Harness: same as patrolDutySession.test.js - snapshots the live schema with
 * pg_dump, seeds an isolated database, boots the real Express server on its
 * own port, and drives it over HTTP.
 *
 * Run from SentrySecurityApp-backend:
 *   node --test tests/dutyCycle24h.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SOURCE_DB = process.env.TEST_SOURCE_DB || 'sentry_security';
const TEST_DB = 'sentry_security_duty_test';
const DB_HOST = process.env.DB_HOST || '/tmp';
const DB_USER = process.env.DB_USER || 'devansh';
const DB_PORT = Number(process.env.DB_PORT || 5432);
// Default port must be unique per test file — parallel `node --test` runs
// share 3479 with payroll.test.js, whose server wins the bind and answers
// this suite's health check with the wrong JWT secret (401s everywhere).
const PORT = Number(process.env.DUTY_TEST_PORT || 3480);
const JWT_SECRET = 'duty-cycle-24h-test-secret';
const BASE = `http://127.0.0.1:${PORT}`;
const DAY_MS = 24 * 60 * 60 * 1000;

let pool = null;
let server = null;
let serverLog = '';
let dumpFile = null;
const photoPaths = [];

const ctx = {
  agencyUserId: null,
  guardUserId: null,
  guardId: null,
  siteId: null,
  guardToken: null,
  session1: null,
  session2: null,
  session3: null,
};

function psql(database, args) {
  execFileSync(
    'psql',
    ['-h', DB_HOST, '-U', DB_USER, '-d', database, '-v', 'ON_ERROR_STOP=1', ...args],
    { stdio: 'pipe' },
  );
}

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
    const insertUser = async (name, email, mobile, type) =>
      (
        await client.query(
          `INSERT INTO users (full_name, mobile_number, email, password, account_type)
           VALUES ($1, $3, $2, 'not-a-real-hash', $4) RETURNING id`,
          [name, email, mobile, type],
        )
      ).rows[0].id;

    ctx.agencyUserId = await insertUser(
      'Duty Cycle Agency', 'duty-agency@duty.test', '+919000000031', 'agency',
    );
    ctx.guardUserId = await insertUser(
      'Duty Cycle Guard', 'duty-guard@duty.test', '+919000000032', 'guard',
    );

    await client.query(
      `INSERT INTO agencies
         (user_id, agency_name, business_type, office_address, city, state, pincode, district, status)
       VALUES ($1, 'Duty Cycle Services', 'private_security', '1 Test Street',
               'Mumbai', 'Maharashtra', '400001', 'Mumbai', 'approved')`,
      [ctx.agencyUserId],
    );

    ctx.siteId = (
      await client.query(
        `INSERT INTO sites
           (agency_id, site_name, site_address, city, state, latitude, longitude,
            coverage_plan, start_time, end_time)
         VALUES ($1, 'Duty Cycle Site', '1 Test Street', 'Mumbai', 'Maharashtra',
                 19.07, 72.87, 'night_watch', '20:00', '06:00')
         RETURNING id`,
        [ctx.agencyUserId],
      )
    ).rows[0].id;

    ctx.guardId = (
      await client.query(
        `INSERT INTO guards
           (user_id, agency_id, site_id, coverage_plan, shift_hours, joining_date,
            start_time, end_time, basic_salary, allowances, address, age, gender, status)
         VALUES ($1, $2, $3, 'night_watch', 10, '2026-01-01', '20:00', '06:00',
                 25000, 0, 'Test address', 30, 'male', 'off_duty')
         RETURNING id`,
        [ctx.guardUserId, ctx.agencyUserId, ctx.siteId],
      )
    ).rows[0].id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  ctx.guardToken = jwt.sign({ id: ctx.guardUserId, account_type: 'guard' }, JWT_SECRET, { expiresIn: '1h' });

  server = spawn(process.execPath, ['index.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      DB_HOST,
      DB_USER,
      DB_PORT: String(DB_PORT),
      DB_PASSWORD: process.env.DB_PASSWORD || '',
      DB_NAME: TEST_DB,
      JWT_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });

  const deadline = Date.now() + 30000;
  let healthy = false;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) { healthy = true; break; }
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!healthy) {
    throw new Error(`Test server failed to start on port ${PORT}:\n${serverLog}`);
  }
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
  for (const rel of photoPaths) {
    if (rel) fs.rmSync(path.join(BACKEND_DIR, String(rel).replace(/^\/+/, '')), { force: true });
  }
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
  try { payload = await res.json(); } catch { /* non-JSON response */ }
  return { status: res.status, body: payload };
}

/** Multipart duty call. Pass withPhoto:false to assert the photo requirement. */
async function apiWithPhoto(method, pathname, { token, withPhoto = true } = {}) {
  const form = new FormData();
  if (withPhoto) {
    form.append(
      'photo',
      new Blob([Buffer.from('fake-duty-photo')], { type: 'image/jpeg' }),
      'duty.jpg',
    );
  }
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON response */ }
  return { status: res.status, body: payload };
}

const dutyStatus = async () =>
  (await api('GET', '/api/guard/duty/status', { token: ctx.guardToken })).body.data;

const dutyRows = async () =>
  (await pool.query(
    'SELECT * FROM duty_logs WHERE guard_id = $1 ORDER BY clock_in_at ASC',
    [ctx.guardId],
  )).rows;

const activeRowCount = async () =>
  Number(
    (await pool.query(
      `SELECT COUNT(*) AS n FROM duty_logs WHERE guard_id = $1 AND status = 'on_duty'`,
      [ctx.guardId],
    )).rows[0].n,
  );

const setClockIn = async (id, interval) =>
  pool.query(
    `UPDATE duty_logs SET clock_in_at = NOW() - INTERVAL '${interval}' WHERE id = $1`,
    [id],
  );

const guardRow = async () =>
  (await pool.query('SELECT status FROM guards WHERE id = $1', [ctx.guardId])).rows[0];

/** Asserts iso ~= expected within toleranceMs. */
const assertNear = (iso, expected, toleranceMs, label) => {
  const actual = Date.parse(iso);
  assert.ok(Number.isFinite(actual), `${label}: ${iso} is a valid timestamp`);
  assert.ok(
    Math.abs(actual - expected.getTime()) <= toleranceMs,
    `${label}: expected ~${expected.toISOString()}, got ${iso}`,
  );
};


test('1. status endpoint reports backend-authoritative eligibility', async () => {
  const status = await dutyStatus();
  assert.equal(status.status, 'off_duty');
  assert.equal(status.active_log, null);
  assert.equal(status.can_start, true, 'first ever duty is allowed');
  assert.equal(status.can_end, false);
  assert.equal(status.next_start_at, null);
});

test('2. photo is required for clock-in and clock-out', async () => {
  const noPhoto = await apiWithPhoto('POST', '/api/guard/duty/clock-in', {
    token: ctx.guardToken,
    withPhoto: false,
  });
  assert.equal(noPhoto.status, 400);
  assert.equal(noPhoto.body.code, 'DUTY_PHOTO_REQUIRED');

  const outNoPhoto = await apiWithPhoto('POST', '/api/guard/duty/clock-out', {
    token: ctx.guardToken,
    withPhoto: false,
  });
  assert.equal(outNoPhoto.status, 400);
  assert.equal(outNoPhoto.body.code, 'DUTY_PHOTO_REQUIRED');

  assert.equal((await dutyRows()).length, 0, 'no session may exist yet');
});

test('3. eligible guard starts duty: ON DUTY, timer source, cycle closed', async () => {
  const clockIn = await apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken });
  assert.equal(clockIn.status, 201);
  ctx.session1 = clockIn.body.data.id;
  photoPaths.push(clockIn.body.data.clock_in_photo);
  assert.ok(clockIn.body.data.clock_in_at, 'server clock_in_at drives the duty timer');
  assert.ok(clockIn.body.data.clock_in_photo, 'photo evidence stored');

  const status = await dutyStatus();
  assert.equal(status.status, 'on_duty');
  assert.equal(status.active_log.id, ctx.session1);
  assert.equal(status.can_start, false, 'no ON DUTY -> ON DUTY');
  assert.equal(status.can_end, true);
  assert.equal(status.next_start_at, null, 'no next start while on duty');
  assert.equal((await guardRow()).status, 'on_duty', 'agency dashboard mirror');
});

test('4. duplicate clock-in is rejected with the existing session', async () => {
  const dup = await apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'DUTY_ALREADY_ACTIVE');
  assert.equal(dup.body.data.id, ctx.session1, 'returns the existing session');
  assert.equal((await dutyRows()).length, 1, 'never a second session');
  assert.equal(await activeRowCount(), 1);
});

test('5. clock-out succeeds and mirrors OFF DUTY', async () => {
  // Backdate slightly so the session has a meaningful measurable duration.
  await setClockIn(ctx.session1, '7 minutes');
  const clockOut = await apiWithPhoto('POST', '/api/guard/duty/clock-out', { token: ctx.guardToken });
  assert.equal(clockOut.status, 200);
  assert.equal(clockOut.body.data.id, ctx.session1);
  photoPaths.push(clockOut.body.data.clock_out_photo);
  assert.ok(clockOut.body.data.clock_out_at);
  assert.ok(Number(clockOut.body.data.duration_minutes) > 0);

  const status = await dutyStatus();
  assert.equal(status.status, 'off_duty');
  assert.equal(status.active_log, null);
  assert.equal(status.can_end, false);
  assert.equal((await guardRow()).status, 'off_duty');
  assert.equal(await activeRowCount(), 0);
});

test('6. duplicate clock-out returns the already-ended state, no new record', async () => {
  const dup = await apiWithPhoto('POST', '/api/guard/duty/clock-out', { token: ctx.guardToken });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'DUTY_NOT_ACTIVE');
  assert.equal(dup.body.data.id, ctx.session1, 'responds with the already-ended session');
  assert.ok(dup.body.data.clock_out_at);
  assert.equal((await dutyRows()).length, 1, 'one duty row, one end record');
});


test('7. clock-in inside the 24-hour cycle is rejected with the next start time', async () => {
  const blocked = await apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'DUTY_COOLING_DOWN');
  assert.ok(blocked.body.next_start_at, 'backend computes the exact next start');

  const session1 = (await dutyRows()).find((r) => r.id === ctx.session1);
  const expected = new Date(new Date(session1.clock_in_at).getTime() + DAY_MS);
  assertNear(blocked.body.next_start_at, expected, 5000, 'next start = last clock_in + 24h');

  const status = await dutyStatus();
  assert.equal(status.can_start, false);
  assertNear(status.next_start_at, expected, 5000, 'status exposes the same cycle end');
});

test('8. after 24 hours a new session starts (and races resolve to one winner)', async () => {
  await setClockIn(ctx.session1, '25 hours');
  const status = await dutyStatus();
  assert.equal(status.can_start, true, 'cycle completed');
  assert.equal(status.next_start_at, null);

  // Double-tap simulation: two identical clock-ins in the same tick.
  const [a, b] = await Promise.all([
    apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken }),
    apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [201, 409], 'exactly one succeeds, one is rejected');
  const rejected = a.status === 409 ? a : b;
  const accepted = a.status === 201 ? a : b;
  assert.equal(rejected.body.code, 'DUTY_ALREADY_ACTIVE');

  ctx.session2 = accepted.body.data.id;
  photoPaths.push(accepted.body.data.clock_in_photo);
  assert.notEqual(ctx.session2, ctx.session1);
  assert.equal(await activeRowCount(), 1, 'never two active sessions');
  assert.equal((await dutyRows()).length, 2);

  // End session 2 so the guard is OFF DUTY again for the anchor tests.
  const clockOut = await apiWithPhoto('POST', '/api/guard/duty/clock-out', { token: ctx.guardToken });
  assert.equal(clockOut.status, 200);
  photoPaths.push(clockOut.body.data.clock_out_photo);
});

test('9. eligibility uses rolling timestamps, not calendar dates (23h vs 25h)', async () => {
  // 23h in: still "yesterday" for a calendar rule, yet blocked for 1 more hour.
  await setClockIn(ctx.session2, '23 hours');
  const blocked = await dutyStatus();
  assert.equal(blocked.can_start, false, '23h since last clock-in is not eligible');
  const expectedNext = new Date(Date.now() + (DAY_MS - 23 * 60 * 60 * 1000));
  assertNear(blocked.next_start_at, expectedNext, 60000, 'next start is exactly clock_in + 24h');

  // 25h in: eligible regardless of which calendar day it falls on.
  await setClockIn(ctx.session2, '25 hours');
  const eligible = await dutyStatus();
  assert.equal(eligible.can_start, true, '25h since last clock-in is eligible');
  assert.equal(eligible.next_start_at, null);
});

test('10. overnight session: started "last evening" stays active across midnight', async () => {
  const clockIn = await apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken });
  assert.equal(clockIn.status, 201);
  ctx.session3 = clockIn.body.data.id;
  photoPaths.push(clockIn.body.data.clock_in_photo);

  // Simulate 20:00 yesterday -> "now" is past midnight; same duty_logs row.
  await setClockIn(ctx.session3, '18 hours');

  const status = await dutyStatus();
  assert.equal(status.status, 'on_duty', 'session survives midnight');
  assert.equal(status.active_log.id, ctx.session3, 'one continuous session, no reset');
  assert.equal(status.can_start, false);
  assert.equal(status.next_start_at, null, 'next start is meaningless while on duty');
});

test('11. simultaneous clock-outs: one end record, one rejection', async () => {
  const [a, b] = await Promise.all([
    apiWithPhoto('POST', '/api/guard/duty/clock-out', { token: ctx.guardToken }),
    apiWithPhoto('POST', '/api/guard/duty/clock-out', { token: ctx.guardToken }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409], 'exactly one end succeeds');
  const rejected = a.status === 409 ? a : b;
  assert.equal(rejected.body.code, 'DUTY_NOT_ACTIVE');

  const rows = await dutyRows();
  const session3 = rows.find((r) => r.id === ctx.session3);
  assert.ok(session3.clock_out_at, 'session 3 ended exactly once');
  assert.equal(rows.filter((r) => r.clock_out_at && r.id === ctx.session3).length, 1);
  assert.equal(rows.length, 3, 'three sessions total, no duplicate records');
  assert.equal(await activeRowCount(), 0);
  assert.equal((await guardRow()).status, 'off_duty');

  const finalStatus = await dutyStatus();
  assert.equal(finalStatus.status, 'off_duty');
  assert.equal(finalStatus.can_start, false, 'cycle 3 anchored to session 3 clock-in (18h ago)');
  const expected = new Date(new Date(session3.clock_in_at).getTime() + DAY_MS);
  assertNear(finalStatus.next_start_at, expected, 5000, 'next start = session3.clock_in + 24h');
});

