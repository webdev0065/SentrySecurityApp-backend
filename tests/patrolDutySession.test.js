/**
 * Session-scoped patrol checkpoint completion - end-to-end DB + API tests.
 *
 * Required scenarios:
 *  1. OFF DUTY: checkpoints read uncompleted; completion rejected by the
 *     backend (403 DUTY_NOT_ACTIVE), including tamper-style direct API calls.
 *  2. Clock-in starts a fresh duty session: progress 0/N.
 *  3. Completion persists across refreshes while the SAME session is active.
 *  4. Duplicate completion in one session: 409, no duplicate record.
 *  5. Overnight: session continuity keyed to the duty_logs row, not the date.
 *  6. Clock-out ends the session: reads reset, round closed, scans rejected.
 *  7. New session resets to 0/N; same checkpoint completable again; old
 *     history preserved (one record per checkpoint per duty session).
 *  8. Checkpoint outside the guard's assigned site is rejected.
 *  9. Both duty sessions remain in patrol history with their duty_log_id.
 *
 * Harness: same as assignmentIntegrity.test.js - snapshots the live schema
 * with pg_dump (the dev schema contains columns added outside migrations),
 * seeds an isolated database, boots the real Express server on its own port,
 * and drives it over HTTP.
 *
 * Run from SentrySecurityApp-backend:
 *   node --test tests/patrolDutySession.test.js
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
const TEST_DB = 'sentry_security_patrol_test';
const DB_HOST = process.env.DB_HOST || '/tmp';
const DB_USER = process.env.DB_USER || 'devansh';
const DB_PORT = Number(process.env.DB_PORT || 5432);
const PORT = Number(process.env.TEST_PORT || 3478);
const JWT_SECRET = 'patrol-duty-session-test-secret';
const BASE = `http://127.0.0.1:${PORT}`;

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
  otherSiteId: null,
  cp: {}, // cp1..cp3 -> checkpoints.id
  otherCpId: null,
  guardToken: null,
  session1: null,
  session2: null,
};

function psql(database, args) {
  execFileSync(
    'psql',
    ['-h', DB_HOST, '-U', DB_USER, '-d', database, '-v', 'ON_ERROR_STOP=1', ...args],
    { stdio: 'pipe' },
  );
}

before(async () => {
  // 1. Schema snapshot of the live database (includes duty_logs and the
  //    duty_log_id column, which only exist after the patrol/duty migrations).
  dumpFile = path.join(os.tmpdir(), `${TEST_DB}-schema.sql`);
  fs.writeFileSync(
    dumpFile,
    execFileSync('pg_dump', ['--schema-only', '--no-owner', '-h', DB_HOST, '-U', DB_USER, SOURCE_DB]),
  );
  psql('postgres', ['-tAc', `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`]);
  psql('postgres', ['-tAc', `CREATE DATABASE ${TEST_DB}`]);
  psql(TEST_DB, ['-f', dumpFile]);

  // 2. Seed one agency, one assigned guard, two sites and four checkpoints.
  pool = new Pool({ host: DB_HOST, user: DB_USER, port: DB_PORT, database: TEST_DB });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertUser = async (name, email, mobile, type) =>
      (
        await client.query(
          `INSERT INTO users (full_name, mobile_number, email, password, account_type)
           VALUES ($1, $2, $3, 'not-a-real-hash', $4) RETURNING id`,
          [name, mobile, email, type],
        )
      ).rows[0].id;

    ctx.agencyUserId = await insertUser(
      'Patrol Test Agency', 'patrol-agency@patrol.test', '+919000000021', 'agency',
    );
    ctx.guardUserId = await insertUser(
      'Patrol Test Guard', 'patrol-guard@patrol.test', '+919000000022', 'guard',
    );

    await client.query(
      `INSERT INTO agencies
         (user_id, agency_name, business_type, office_address, city, state, pincode, district, status)
       VALUES ($1, 'Patrol Test Services', 'private_security', '1 Test Street',
               'Mumbai', 'Maharashtra', '400001', 'Mumbai', 'approved')`,
      [ctx.agencyUserId],
    );

    const insertSite = async (name, lat, lng) =>
      (
        await client.query(
          `INSERT INTO sites
             (agency_id, site_name, site_address, city, state, latitude, longitude,
              coverage_plan, start_time, end_time)
           VALUES ($1, $2, '1 Test Street', 'Mumbai', 'Maharashtra', $3, $4,
                   'day_shift', '09:00', '18:00')
           RETURNING id`,
          [ctx.agencyUserId, name, lat, lng],
        )
      ).rows[0].id;
    ctx.siteId = await insertSite('Patrol Site A', 19.07, 72.87);
    ctx.otherSiteId = await insertSite('Patrol Site B', 19.08, 72.88);

    // Site A has no source coverage request, so the capacity trigger treats
    // its capacity as unbounded and allows the direct assignment.
    ctx.guardId = (
      await client.query(
        `INSERT INTO guards
           (user_id, agency_id, site_id, coverage_plan, shift_hours, joining_date,
            start_time, end_time, basic_salary, allowances, address, age, gender, status)
         VALUES ($1, $2, $3, 'day_shift', 8, '2026-01-01', '09:00', '18:00',
                 25000, 0, 'Test address', 30, 'male', 'off_duty')
         RETURNING id`,
        [ctx.guardUserId, ctx.agencyUserId, ctx.siteId],
      )
    ).rows[0].id;

    for (const [key, name, seq] of [
      ['cp1', 'Main Entrance', 1],
      ['cp2', 'Back Gate', 2],
      ['cp3', 'Roof Terrace', 3],
    ]) {
      ctx.cp[key] = (
        await client.query(
          'INSERT INTO checkpoints (site_id, name, sequence_order) VALUES ($1, $2, $3) RETURNING id',
          [ctx.siteId, name, seq],
        )
      ).rows[0].id;
    }
    ctx.otherCpId = (
      await client.query(
        'INSERT INTO checkpoints (site_id, name, sequence_order) VALUES ($1, $2, 1) RETURNING id',
        [ctx.otherSiteId, 'Other Site Checkpoint'],
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

  // 3. Boot the real server against the test database.
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
  try {
    payload = await res.json();
  } catch { /* non-JSON response */ }
  return { status: res.status, body: payload };
}

/** Multipart call carrying the photo that duty clock-in/out requires. */
async function apiWithPhoto(method, pathname, { token } = {}) {
  const form = new FormData();
  form.append(
    'photo',
    new Blob([Buffer.from('fake-duty-photo')], { type: 'image/jpeg' }),
    'duty.jpg',
  );
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch { /* non-JSON response */ }
  return { status: res.status, body: payload };
}

const patrolData = async () =>
  (await api('GET', '/api/guard/patrol/checkpoints', { token: ctx.guardToken })).body.data;

const scanCount = async (checkpointId) =>
  Number(
    (
      await pool.query(
        checkpointId
          ? 'SELECT COUNT(*) AS n FROM patrol_scans WHERE checkpoint_id = $1'
          : 'SELECT COUNT(*) AS n FROM patrol_scans',
        checkpointId ? [checkpointId] : [],
      )
    ).rows[0].n,
  );

test('1. OFF DUTY: checkpoints read uncompleted and completion is rejected', async () => {
  const status = await api('GET', '/api/guard/duty/status', { token: ctx.guardToken });
  assert.equal(status.body.data.status, 'off_duty');
  assert.equal(status.body.data.active_log, null);

  const patrol = await patrolData();
  assert.equal(patrol.checkpoints.length, 3);
  for (const cp of patrol.checkpoints) {
    assert.equal(cp.visited, false, `${cp.name} must read uncompleted while off duty`);
  }

  // Tamper check: direct API completion while off duty is refused by backend.
  const scan = await api('POST', `/api/guard/patrol/checkpoints/${ctx.cp.cp1}/scan`, {
    token: ctx.guardToken,
  });
  assert.equal(scan.status, 403);
  assert.equal(scan.body.code, 'DUTY_NOT_ACTIVE');
  assert.match(scan.body.message, /not on duty/i);

  const start = await api('POST', '/api/guard/patrol/rounds/start', { token: ctx.guardToken });
  assert.equal(start.status, 403);

  const active = await api('GET', '/api/guard/patrol/rounds/active', { token: ctx.guardToken });
  assert.equal(active.body.data, null);

  assert.equal(await scanCount(), 0, 'no completion record may exist off duty');
});

test('2. clock-in starts a fresh duty session at 0/N', async () => {
  const clockIn = await apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken });
  assert.equal(clockIn.status, 201);
  ctx.session1 = clockIn.body.data.id;
  photoPaths.push(clockIn.body.data.clock_in_photo);
  assert.ok(ctx.session1);

  const status = await api('GET', '/api/guard/duty/status', { token: ctx.guardToken });
  assert.equal(status.body.data.status, 'on_duty');
  assert.ok(status.body.data.active_log.clock_in_at, 'authoritative timer source exists');

  const patrol = await patrolData();
  assert.equal(
    patrol.checkpoints.filter((cp) => cp.visited).length,
    0,
    'new duty session must start at 0/N',
  );
});

test('3. completion persists across refreshes within the active session', async () => {
  const scan = await api('POST', `/api/guard/patrol/checkpoints/${ctx.cp.cp1}/scan`, {
    token: ctx.guardToken,
  });
  assert.equal(scan.status, 201);
  assert.equal(scan.body.data.progress.scanned, 1);
  assert.equal(scan.body.data.progress.total, 3);
  assert.equal(scan.body.data.round_completed, false);

  // Two refreshes: state must come from the server, not client memory.
  for (let i = 0; i < 2; i += 1) {
    const patrol = await patrolData();
    assert.deepEqual(
      patrol.checkpoints.map((cp) => [cp.name, cp.visited]),
      [['Main Entrance', true], ['Back Gate', false], ['Roof Terrace', false]],
    );
  }
  assert.equal(await scanCount(ctx.cp.cp1), 1);
});

test('4. duplicate completion in the same session leaves a single record', async () => {
  const dup = await api('POST', `/api/guard/patrol/checkpoints/${ctx.cp.cp1}/scan`, {
    token: ctx.guardToken,
  });
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /already scanned/i);
  assert.equal(await scanCount(ctx.cp.cp1), 1, 'exactly one completion record per session');
});

test('5. overnight continuity: session is keyed to the duty log, not the date', async () => {
  await pool.query(
    "UPDATE duty_logs SET clock_in_at = NOW() - INTERVAL '1 day' WHERE id = $1",
    [ctx.session1],
  );
  const patrol = await patrolData();
  const cp1 = patrol.checkpoints.find((cp) => cp.id === ctx.cp.cp1);
  assert.equal(cp1.visited, true, 'progress must survive a midnight rollover');

  const scan = await api('POST', `/api/guard/patrol/checkpoints/${ctx.cp.cp2}/scan`, {
    token: ctx.guardToken,
  });
  assert.equal(scan.status, 201, 'still the same on-duty session');
});

test('6. clock-out ends the session: reads reset, round closed, scans rejected', async () => {
  const clockOut = await apiWithPhoto('POST', '/api/guard/duty/clock-out', { token: ctx.guardToken });
  assert.equal(clockOut.status, 200);
  photoPaths.push(clockOut.body.data.clock_out_photo);

  const status = await api('GET', '/api/guard/duty/status', { token: ctx.guardToken });
  assert.equal(status.body.data.status, 'off_duty');

  const patrol = await patrolData();
  assert.equal(
    patrol.checkpoints.filter((cp) => cp.visited).length,
    0,
    'previous session must not show as current progress',
  );

  const round = (
    await pool.query('SELECT * FROM patrol_rounds WHERE guard_id = $1 AND duty_log_id = $2', [
      ctx.guardId,
      ctx.session1,
    ])
  ).rows[0];
  assert.ok(round, 'the session round exists for reporting');
  assert.equal(round.status, 'completed', 'clock-out closes the session round');
  assert.equal(Number(round.scanned_count), 2);

  const scan = await api('POST', `/api/guard/patrol/checkpoints/${ctx.cp.cp3}/scan`, {
    token: ctx.guardToken,
  });
  assert.equal(scan.status, 403, 'completion rejected again after clock-out');

  const active = await api('GET', '/api/guard/patrol/rounds/active', { token: ctx.guardToken });
  assert.equal(active.body.data, null);
  assert.equal(await scanCount(), 2, 'history rows are untouched, nothing new added');
});

test('7. new session resets to 0/N and the same checkpoint is completable again', async () => {
  const clockIn = await apiWithPhoto('POST', '/api/guard/duty/clock-in', { token: ctx.guardToken });
  assert.equal(clockIn.status, 201);
  ctx.session2 = clockIn.body.data.id;
  photoPaths.push(clockIn.body.data.clock_in_photo);
  assert.notEqual(ctx.session2, ctx.session1, 'a new duty session is a new duty_logs row');

  const patrol = await patrolData();
  assert.equal(
    patrol.checkpoints.filter((cp) => cp.visited).length,
    0,
    'new duty session must start at 0/N even though history exists',
  );

  const scan = await api('POST', `/api/guard/patrol/checkpoints/${ctx.cp.cp1}/scan`, {
    token: ctx.guardToken,
  });
  assert.equal(scan.status, 201, 'same checkpoint must be completable in a new session');

  const rows = (
    await pool.query(
      `SELECT pr.duty_log_id FROM patrol_scans ps
       JOIN patrol_rounds pr ON pr.id = ps.round_id
       WHERE ps.guard_id = $1 AND ps.checkpoint_id = $2
       ORDER BY ps.id`,
      [ctx.guardId, ctx.cp.cp1],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => Number(r.duty_log_id)),
    [ctx.session1, ctx.session2],
    'exactly one record per checkpoint per duty session, kept in history',
  );
});

test('8. checkpoint outside the guard assigned site is rejected', async () => {
  const scan = await api('POST', `/api/guard/patrol/checkpoints/${ctx.otherCpId}/scan`, {
    token: ctx.guardToken,
  });
  assert.equal(scan.status, 400);
  assert.match(scan.body.message, /assigned site/i);
  assert.equal(await scanCount(ctx.otherCpId), 0);
});

test('9. both duty sessions remain in patrol history with their duty links', async () => {
  const rounds = (await api('GET', '/api/guard/patrol/rounds', { token: ctx.guardToken })).body.data;
  assert.equal(rounds.length, 2, 'one round per duty session');
  const byDuty = Object.fromEntries(rounds.map((r) => [Number(r.duty_log_id), r.status]));
  assert.equal(byDuty[ctx.session1], 'completed');
  assert.equal(byDuty[ctx.session2], 'in_progress');
  assert.ok(
    rounds.every((r) => r.duty_log_id != null),
    'new rounds must be linked to their duty session',
  );

  const active = await api('GET', '/api/guard/patrol/rounds/active', { token: ctx.guardToken });
  assert.equal(Number(active.body.data.round.duty_log_id), ctx.session2);
});
