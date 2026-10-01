/**
 * Guard assignment integrity - end-to-end DB + API tests.
 *
 * Required scenarios covered:
 *  0. Schema backstop objects (partial index + capacity trigger) exist
 *  1. Normal assignment succeeds
 *  2. Duplicate assignment rejected (DUPLICATE_ASSIGNMENT), no state change
 *  3. Cross-site move rejected (GUARD_ALREADY_ASSIGNED) in both flows
 *  4. Site capacity enforced (SITE_CAPACITY_REACHED) on assign + guard create
 *  5. Unassign (siteId: null) releases the slot for a new guard
 *  6. Historical (completed / ended) assignments never block new ones
 *  7. Concurrency: same guard for two sites in parallel - exactly one wins
 *  8. Concurrency: capacity race - site never exceeds coverage_requests.guards_needed
 *  9. Concurrency: duplicate submit of the same request commits exactly once
 * 10. Unauthorized access (guard / client / anonymous) denied
 * 11. DB trigger backstop rejects out-of-band writes; normalizeError maps it
 * 12. Global invariant: no site over capacity
 *
 * Harness: snapshots the live schema with pg_dump (the dev schema contains
 * columns added outside migrations, so re-running migrations alone would not
 * reproduce it), seeds an isolated database, boots the real Express server on
 * its own port, and drives it over HTTP.
 *
 * Run from SentrySecurityApp-backend:
 *   node --test tests/assignmentIntegrity.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const GuardAssignmentService = require('../data/services/GuardAssignmentService');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SOURCE_DB = process.env.TEST_SOURCE_DB || 'sentry_security';
const TEST_DB = 'sentry_security_assignment_test';
const DB_HOST = process.env.DB_HOST || '/tmp';
const DB_USER = process.env.DB_USER || 'devansh';
const DB_PORT = Number(process.env.DB_PORT || 5432);
const PORT = Number(process.env.TEST_PORT || 3477);
const JWT_SECRET = 'assignment-integrity-test-secret';
const BASE = `http://127.0.0.1:${PORT}`;

let pool = null;
let server = null;
let serverLog = '';
let dumpFile = null;

const ctx = {
  agencyUserId: null,
  agencyRowId: null,
  clientUserId: null,
  guardUserIds: [],
  guard: {}, // g1..g10 -> guards.id
  cr: {}, // cr1.. -> coverage_requests.id
  site: {}, // s1.. -> sites.id
  agencyToken: null,
  clientToken: null,
  guardToken: null,
};

function psql(database, args) {
  execFileSync(
    'psql',
    ['-h', DB_HOST, '-U', DB_USER, '-d', database, '-v', 'ON_ERROR_STOP=1', ...args],
    { stdio: 'pipe' },
  );
}

before(async () => {
  // 1. Schema snapshot of the live database: includes the assignment partial
  //    index, the capacity trigger, and columns that exist only in the live
  //    schema (e.g. agencies.status, guards.joining_date).
  dumpFile = path.join(os.tmpdir(), `${TEST_DB}-schema.sql`);
  fs.writeFileSync(
    dumpFile,
    execFileSync('pg_dump', ['--schema-only', '--no-owner', '-h', DB_HOST, '-U', DB_USER, SOURCE_DB]),
  );
  psql('postgres', ['-tAc', `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`]);
  psql('postgres', ['-tAc', `CREATE DATABASE ${TEST_DB}`]);
  psql(TEST_DB, ['-f', dumpFile]);

  // 2. Seed an agency, client, ten guards, eight coverage requests with linked
  //    sites (capacity 1 or 2) and an active Pro subscription.
  pool = new Pool({ host: DB_HOST, user: DB_USER, port: DB_PORT, database: TEST_DB });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertUser = async (name, mobile, email, type) =>
      (
        await client.query(
          `INSERT INTO users (full_name, mobile_number, email, password, account_type)
           VALUES ($1, $2, $3, 'not-a-real-hash', $4) RETURNING id`,
          [name, mobile, email, type],
        )
      ).rows[0].id;

    ctx.agencyUserId = await insertUser('Test Agency Owner', '+919000000001', 'agency@assignment.test', 'agency');
    ctx.clientUserId = await insertUser('Test Client', '+919000000002', 'client@assignment.test', 'client');
    for (let i = 1; i <= 10; i += 1) {
      ctx.guardUserIds.push(
        await insertUser(
          `Guard ${i}`,
          `+9190000001${String(i).padStart(2, '0')}`,
          `guard${i}@assignment.test`,
          'guard',
        ),
      );
    }

    ctx.agencyRowId = (
      await client.query(
        `INSERT INTO agencies
           (user_id, agency_name, business_type, office_address, city, state, pincode, district, status)
         VALUES ($1, 'Test Security Services Pvt Ltd', 'private_security', '1 Test Street',
                 'Mumbai', 'Maharashtra', '400001', 'Mumbai', 'approved')
         RETURNING id`,
        [ctx.agencyUserId],
      )
    ).rows[0].id;

    const clientRowId = (
      await client.query(
        `INSERT INTO clients (user_id, company_name, site_name, site_address, city, state, pincode)
         VALUES ($1, 'Acme Corp', 'Acme HQ', '2 Test Road', 'Mumbai', 'Maharashtra', '400001')
         RETURNING id`,
        [ctx.clientUserId],
      )
    ).rows[0].id;

    // plans rows are data (migration-seeded), not schema - pg_dump --schema-only
    // leaves the table empty, so re-seed them before subscribing the agency.
    await client.query(
      `INSERT INTO plans (name, price, max_guards, max_sites, features)
       VALUES
         ('Basic', 4999, 5, 2, '[]'::jsonb),
         ('Pro', 12999, 50, 15, '[]'::jsonb)
       ON CONFLICT (name) DO NOTHING`,
    );

    await client.query(
      `INSERT INTO agency_subscriptions (agency_id, plan_id, status, started_at, renews_at)
       SELECT $1, id, 'active', NOW(), NOW() + INTERVAL '1 month'
       FROM plans WHERE name = 'Pro'`,
      [ctx.agencyUserId],
    );

    for (let i = 1; i <= 10; i += 1) {
      ctx.guard[`g${i}`] = (
        await client.query(
          `INSERT INTO guards
             (user_id, agency_id, site_id, coverage_plan, shift_hours, joining_date,
              start_time, end_time, basic_salary, allowances, address, age, gender, status)
           VALUES ($1, $2, NULL, 'day_shift', 8, '2026-01-01', '09:00', '18:00',
                   25000, 0, 'Test address', 30, 'male', 'off_duty')
           RETURNING id`,
          [ctx.guardUserIds[i - 1], ctx.agencyUserId],
        )
      ).rows[0].id;
    }

    const crSpecs = [
      ['cr1', 2, 'approved', null],
      ['cr2', 1, 'approved', null],
      ['cr3', 1, 'approved', null],
      ['cr4', 2, 'approved', null],
      ['cr5', 1, 'approved', null],
      ['cr6', 1, 'completed', [ctx.guard.g10]],
      ['cr7', 2, 'approved', null],
      ['cr9', 2, 'approved', null],
    ];
    for (const [key, guardsNeeded, status, assignedGuardIds] of crSpecs) {
      const crId = (
        await client.query(
          `INSERT INTO coverage_requests
             (client_id, event_name, state, district, city, pincode, site_location,
              guards_needed, status, selected_agency_id, assigned_agency_id, assigned_guard_ids)
           VALUES ($1, 'Test Event', 'Maharashtra', 'Mumbai', 'Mumbai', '400001', 'Test Location',
                   $2, $3, $4, $4, $5)
           RETURNING id`,
          [clientRowId, guardsNeeded, status, ctx.agencyRowId, assignedGuardIds],
        )
      ).rows[0].id;
      ctx.cr[key] = crId;
      const siteKey = key.replace('cr', 's');
      ctx.site[siteKey] = (
        await client.query(
          `INSERT INTO sites
             (agency_id, site_name, site_address, city, state, latitude, longitude,
              coverage_plan, start_time, end_time, source_coverage_request_id)
           VALUES ($1, $2, '1 Test Street', 'Mumbai', 'Maharashtra', 19.07, 72.87,
                   'day_shift', '09:00', '18:00', $3)
           RETURNING id`,
          [ctx.agencyUserId, `Site ${siteKey.slice(1)}`, crId],
        )
      ).rows[0].id;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  ctx.agencyToken = jwt.sign({ id: ctx.agencyUserId, account_type: 'agency' }, JWT_SECRET, { expiresIn: '1h' });
  ctx.clientToken = jwt.sign({ id: ctx.clientUserId, account_type: 'client' }, JWT_SECRET, { expiresIn: '1h' });
  ctx.guardToken = jwt.sign({ id: ctx.guardUserIds[0], account_type: 'guard' }, JWT_SECRET, { expiresIn: '1h' });

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

const guardById = async (id) =>
  (await pool.query('SELECT * FROM guards WHERE id = $1', [id])).rows[0];
const crById = async (id) =>
  (await pool.query('SELECT * FROM coverage_requests WHERE id = $1', [id])).rows[0];
const siteOccupancy = async (siteId) =>
  Number(
    (await pool.query('SELECT COUNT(*) AS n FROM guards WHERE site_id = $1', [siteId])).rows[0].n,
  );
const freeGuardIds = async (limit = 2) =>
  (
    await pool.query(
      'SELECT id FROM guards WHERE agency_id = $1 AND site_id IS NULL ORDER BY id LIMIT $2',
      [ctx.agencyUserId, limit],
    )
  ).rows.map((row) => row.id);

const toDateOnly = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/** Full PUT /api/agency/guards/:id payload built from the current DB row. */
async function guardUpdatePayload(guardId, siteId) {
  const row = (
    await pool.query(
      `SELECT g.*, u.full_name, u.mobile_number, u.email
         FROM guards g JOIN users u ON u.id = g.user_id
        WHERE g.id = $1`,
      [guardId],
    )
  ).rows[0];
  return {
    fullName: row.full_name,
    mobileNumber: row.mobile_number,
    email: row.email,
    joiningDate: toDateOnly(row.joining_date),
    siteId,
    coveragePlan: row.coverage_plan,
    shiftHours: row.shift_hours ?? 8,
    startTime: row.start_time ?? '09:00',
    endTime: row.end_time ?? '18:00',
    basicSalary: Number(row.basic_salary ?? 25000),
    allowances: Number(row.allowances ?? 0),
    address: row.address ?? 'Test address',
    age: row.age ?? 30,
    gender: row.gender ?? 'male',
  };
}

/** PUT /api/agency/coverage-requests/:id with status "assigned". */
const assign = (crKey, guardIds) =>
  api('PUT', `/api/agency/coverage-requests/${ctx.cr[crKey]}`, {
    token: ctx.agencyToken,
    body: { status: 'assigned', guardIds },
  });

const newGuardBody = (siteId) => ({
  fullName: 'Newly Created Guard',
  mobileNumber: '+919000000199',
  email: 'new.guard@assignment.test',
  password: 'secret1',
  joiningDate: '2026-02-01',
  siteId,
  coveragePlan: 'day_shift',
  shiftHours: 8,
  startTime: '09:00',
  endTime: '18:00',
  basicSalary: 25000,
  address: 'Test address',
  gender: 'male',
});

test('0. schema backstop objects exist (partial index + capacity trigger)', async () => {
  const index = await pool.query(
    "SELECT 1 FROM pg_indexes WHERE indexname = 'guards_site_id_active_idx'",
  );
  assert.equal(index.rowCount, 1);
  const trigger = await pool.query(
    "SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enforce_site_guard_capacity' AND NOT tgisinternal",
  );
  assert.equal(trigger.rowCount, 1);
  const fn = await pool.query(
    "SELECT 1 FROM pg_proc WHERE proname = 'enforce_site_guard_capacity'",
  );
  assert.equal(fn.rowCount, 1);
});

test('1. normal assignment succeeds end to end', async () => {
  const res = await assign('cr1', [ctx.guard.g1, ctx.guard.g2]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal((await guardById(ctx.guard.g1)).site_id, ctx.site.s1);
  assert.equal((await guardById(ctx.guard.g2)).site_id, ctx.site.s1);
  const cr = await crById(ctx.cr.cr1);
  assert.equal(cr.status, 'assigned');
  assert.deepEqual(cr.assigned_guard_ids, [ctx.guard.g1, ctx.guard.g2]);
  assert.equal(await siteOccupancy(ctx.site.s1), 2);
});

test('2. duplicate assignment rejected without any state change', async () => {
  // Re-submitting only g1 would rewrite assigned_guard_ids if it slipped through.
  const res = await assign('cr1', [ctx.guard.g1]);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'DUPLICATE_ASSIGNMENT');
  assert.equal(typeof res.body.message, 'string');
  assert.ok(res.body.message.length > 0);
  const cr = await crById(ctx.cr.cr1);
  assert.deepEqual(cr.assigned_guard_ids, [ctx.guard.g1, ctx.guard.g2]);
  assert.equal(await siteOccupancy(ctx.site.s1), 2);
});

test('3. cross-site move rejected by both flows (no auto-move)', async () => {
  const viaCoverage = await assign('cr2', [ctx.guard.g1]);
  assert.equal(viaCoverage.status, 409, JSON.stringify(viaCoverage.body));
  assert.equal(viaCoverage.body.code, 'GUARD_ALREADY_ASSIGNED');
  assert.equal((await guardById(ctx.guard.g1)).site_id, ctx.site.s1);
  assert.equal((await crById(ctx.cr.cr2)).assigned_guard_ids, null);

  const payload = await guardUpdatePayload(ctx.guard.g1, ctx.site.s2);
  const viaUpdate = await api('PUT', `/api/agency/guards/${ctx.guard.g1}`, {
    token: ctx.agencyToken,
    body: payload,
  });
  assert.equal(viaUpdate.status, 409, JSON.stringify(viaUpdate.body));
  assert.equal(viaUpdate.body.code, 'GUARD_ALREADY_ASSIGNED');
  assert.equal((await guardById(ctx.guard.g1)).site_id, ctx.site.s1);
});

test('4. capacity enforced for re-assignment and guard creation', async () => {
  const first = await assign('cr5', [ctx.guard.g3]);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal((await guardById(ctx.guard.g3)).site_id, ctx.site.s5);

  const second = await assign('cr5', [ctx.guard.g4]);
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body.code, 'SITE_CAPACITY_REACHED');

  const created = await api('POST', '/api/agency/guards', {
    token: ctx.agencyToken,
    body: newGuardBody(ctx.site.s5),
  });
  assert.equal(created.status, 409, JSON.stringify(created.body));
  assert.equal(created.body.code, 'SITE_CAPACITY_REACHED');
  assert.equal(await siteOccupancy(ctx.site.s5), 1);
});

test('5. unassigning (siteId: null) releases the slot for a new guard', async () => {
  const payload = await guardUpdatePayload(ctx.guard.g3, null);
  const unassign = await api('PUT', `/api/agency/guards/${ctx.guard.g3}`, {
    token: ctx.agencyToken,
    body: payload,
  });
  assert.equal(unassign.status, 200, JSON.stringify(unassign.body));
  assert.equal((await guardById(ctx.guard.g3)).site_id, null);
  assert.equal(await siteOccupancy(ctx.site.s5), 0);

  const assignNext = await assign('cr5', [ctx.guard.g4]);
  assert.equal(assignNext.status, 200, JSON.stringify(assignNext.body));
  assert.equal((await guardById(ctx.guard.g4)).site_id, ctx.site.s5);
  assert.equal(await siteOccupancy(ctx.site.s5), 1);
});

test('6. historical (completed) assignment never blocks a new one', async () => {
  const cr6 = await crById(ctx.cr.cr6);
  assert.equal(cr6.status, 'completed');
  assert.deepEqual(cr6.assigned_guard_ids, [ctx.guard.g10]);
  assert.equal(await siteOccupancy(ctx.site.s6), 0);

  const res = await assign('cr2', [ctx.guard.g10]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await guardById(ctx.guard.g10)).site_id, ctx.site.s2);

  const stillHistorical = await crById(ctx.cr.cr6);
  assert.equal(stillHistorical.status, 'completed');
  assert.deepEqual(stillHistorical.assigned_guard_ids, [ctx.guard.g10]);
  assert.equal(await siteOccupancy(ctx.site.s6), 0);
});

test('7. concurrency: same guard for two sites - exactly one wins', async () => {
  const [r3, r4] = await Promise.all([
    assign('cr3', [ctx.guard.g5]),
    assign('cr4', [ctx.guard.g5]),
  ]);
  const statuses = [r3.status, r4.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], JSON.stringify([r3.body, r4.body]));

  const winnerIsCr3 = r3.status === 200;
  const loser = winnerIsCr3 ? r4 : r3;
  const loserKey = winnerIsCr3 ? 'cr4' : 'cr3';
  assert.equal(loser.body.code, 'GUARD_ALREADY_ASSIGNED');
  assert.equal(
    (await guardById(ctx.guard.g5)).site_id,
    ctx.site[winnerIsCr3 ? 's3' : 's4'],
  );
  assert.equal((await crById(ctx.cr[loserKey])).assigned_guard_ids, null);
  assert.equal(await siteOccupancy(ctx.site[winnerIsCr3 ? 's4' : 's3']), 0);
});

test('8. concurrency: capacity race never exceeds guards_needed (cr7 capacity 2)', async () => {
  const guardIds = [ctx.guard.g6, ctx.guard.g7, ctx.guard.g8, ctx.guard.g9];
  const results = await Promise.all(guardIds.map((id) => assign('cr7', [id])));
  const ok = results.filter((r) => r.status === 200);
  const capped = results.filter((r) => r.status === 409);
  assert.equal(
    ok.length,
    2,
    JSON.stringify(results.map((r) => [r.status, r.body && r.body.code])),
  );
  assert.equal(capped.length, 2);
  for (const r of capped) assert.equal(r.body.code, 'SITE_CAPACITY_REACHED');
  assert.equal(await siteOccupancy(ctx.site.s7), 2);
});

test('9. concurrency: duplicate submit of the same request commits exactly once', async () => {
  const free = await freeGuardIds(2);
  assert.equal(free.length, 2, 'expected two free guards for this scenario');
  const [a, b] = free;
  const body = { status: 'assigned', guardIds: [a, b] };
  const [x, y] = await Promise.all([
    api('PUT', `/api/agency/coverage-requests/${ctx.cr.cr9}`, { token: ctx.agencyToken, body }),
    api('PUT', `/api/agency/coverage-requests/${ctx.cr.cr9}`, { token: ctx.agencyToken, body }),
  ]);
  const statuses = [x.status, y.status].sort((p, q) => p - q);
  assert.deepEqual(statuses, [200, 409], JSON.stringify([x.body, y.body]));
  const loser = x.status === 409 ? x : y;
  assert.equal(loser.body.code, 'DUPLICATE_ASSIGNMENT');
  assert.equal(await siteOccupancy(ctx.site.s9), 2);
  assert.deepEqual((await crById(ctx.cr.cr9)).assigned_guard_ids, [a, b]);
});

test('10. unauthorized access is denied (guard / client / anonymous)', async () => {
  const free = await freeGuardIds(1);
  assert.equal(free.length, 1, 'expected exactly one free guard after test 9');

  // Guard token against the agency assignment endpoint
  const guardAttempt = await api('PUT', `/api/agency/coverage-requests/${ctx.cr.cr1}`, {
    token: ctx.guardToken,
    body: { status: 'assigned', guardIds: free },
  });
  assert.equal(guardAttempt.status, 403);
  assert.equal(guardAttempt.body.message, 'Agency access required');

  // Client token trying to create (and thereby assign) a guard
  const clientAttempt = await api('POST', '/api/agency/guards', {
    token: ctx.clientToken,
    body: newGuardBody(ctx.site.s1),
  });
  assert.ok(
    clientAttempt.status >= 400,
    `client token must be denied, got ${clientAttempt.status}`,
  );

  // Anonymous request
  const anonymous = await api('PUT', `/api/agency/coverage-requests/${ctx.cr.cr1}`, {
    body: { status: 'approved' },
  });
  assert.equal(anonymous.status, 401);

  // Nothing was mutated by any denied attempt
  assert.equal((await guardById(free[0])).site_id, null);
  assert.equal((await crById(ctx.cr.cr1)).status, 'assigned');
  const leaked = await pool.query(
    "SELECT 1 FROM users WHERE email = 'new.guard@assignment.test'",
  );
  assert.equal(leaked.rowCount, 0);
});

test('11. DB trigger backstop rejects out-of-band over-capacity writes', async () => {
  const free = await freeGuardIds(1);
  assert.equal(free.length, 1);
  const freeId = free[0];

  // s5 is at capacity (1/1 with g4 after test 5).
  await assert.rejects(
    () => pool.query('UPDATE guards SET site_id = $1 WHERE id = $2', [ctx.site.s5, freeId]),
    (err) => {
      assert.equal(err.code, '23514'); // check_violation from the trigger
      assert.match(err.message, /SITE_CAPACITY_REACHED/);
      return true;
    },
  );
  assert.equal((await guardById(freeId)).site_id, null);

  // Routes map this exact failure through normalizeError to the API contract.
  let triggerError = null;
  try {
    await pool.query('UPDATE guards SET site_id = $1 WHERE id = $2', [ctx.site.s5, freeId]);
  } catch (err) {
    triggerError = err;
  }
  assert.ok(triggerError, 'expected the trigger to raise again');
  const mapped = GuardAssignmentService.normalizeError(triggerError);
  assert.equal(mapped.name, 'AssignmentError');
  assert.equal(mapped.code, 'SITE_CAPACITY_REACHED');
  assert.equal(mapped.status, 409);
  assert.match(mapped.message, /up to 1 guard/);
});

test('12. global invariant: no site exceeds its capacity', async () => {
  const over = await pool.query(`
    SELECT s.id, COUNT(g.id)::int AS assigned, cr.guards_needed
      FROM sites s
      JOIN coverage_requests cr ON cr.id = s.source_coverage_request_id
      LEFT JOIN guards g ON g.site_id = s.id
     WHERE cr.guards_needed IS NOT NULL
     GROUP BY s.id, cr.guards_needed
    HAVING COUNT(g.id) > cr.guards_needed
  `);
  assert.equal(over.rowCount, 0, JSON.stringify(over.rows));
});
