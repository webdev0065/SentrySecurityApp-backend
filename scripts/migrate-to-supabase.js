/**
 * Supabase production migration.
 *
 * Run ON THE DEPLOY HOST (https://api.31-97-202-98.sslip.io machine),
 * NOT on this Mac — Supabase DNS does not resolve from here.
 *
 * Prerequisites on the deploy host:
 *   1. Backend repo checked out at the same commit as this file.
 *   2. `npm install` completed (needs `pg`, `node-pg-migrate`).
 *   3. Outbound access to the Supabase Session Pooler host (see DATABASE_URL).
 *   4. The CURRENT production Postgres reachable (for the data-copy step).
 *
 * Required env (export before running — NEVER commit the real value):
 *   export DATABASE_URL='postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require'
 *   export SOURCE_DATABASE_URL='postgresql://<current-prod-user>:<pass>@<current-prod-host>:5432/<db>?sslmode=require'
 *   # If the current prod DB lives on the same host, SOURCE_DATABASE_URL can
 *   # point at it directly. For a local dump file instead, use --from-dump.
 *
 * Usage:
 *   node scripts/migrate-to-supabase.js --schema-only   # safe: migrations + table list only
 *   node scripts/migrate-to-supabase.js --i-know-this-truncates-the-target
 *       # schema + data from SOURCE_DATABASE_URL (TRUNCATEs every target table)
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');

const TABLES_IN_FK_ORDER = [
  'users',
  'super_admins',
  'agencies',
  'clients',
  'plans',
  'sites',
  'guards',
  'coverage_requests',
  'coverage_request_checkpoints',
  'checkpoints',
  'incidents',
  'incident_images',
  'duty_logs',
  'patrol_rounds',
  'patrol_scans',
  'payroll_records',
  'salary_advances',
  'invoices',
  'notifications',
  'agency_subscriptions',
  'client_ratings',
];

function sh(cmd, args, env) {
  return execFileSync(cmd, args, {
    cwd: BACKEND_DIR,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
  });
}

function psql(url, sql) {
  return sh('psql', [url, '-v', 'ON_ERROR_STOP=1', '-tAc', sql]).trim();
}

function main() {
  const args = process.argv.slice(2);
  const schemaOnly = args.includes('--schema-only');

  // The data-copy step TRUNCATEs every target table with CASCADE, which is
  // irreversibly destructive if it ever runs against a live database. Require
  // an explicit opt-in flag so it cannot fire from a stray invocation.
  if (!schemaOnly && !args.includes('--i-know-this-truncates-the-target')) {
    console.error(
      'Refusing to run the data-copy step: it TRUNCATEs every table in DATABASE_URL.\n' +
      '  * Schema only (safe): node scripts/migrate-to-supabase.js --schema-only\n' +
      '  * Full data copy (DESTRUCTIVE on the target): add --i-know-this-truncates-the-target'
    );
    process.exit(1);
  }

  const target = (process.env.DATABASE_URL || '').trim();
  if (!/^postgresql:\/\//.test(target)) {
    console.error('DATABASE_URL must be set to the Supabase connection string.');
    process.exit(1);
  }

  console.log('1/4 Verifying Supabase connectivity…');
  console.log('    server:', psql(target, 'SELECT version();').split(' ').slice(0, 2).join(' '));

  console.log('2/4 Running node-pg-migrate schema migrations…');
  sh('npx', ['node-pg-migrate', 'up', '--database-url-var', 'DATABASE_URL'], { DATABASE_URL: target });
  const applied = psql(target, 'SELECT count(*) FROM pgmigrations;');
  console.log(`    pgmigrations rows: ${applied}`);
  if (Number(applied) < 26) {
    console.error(`    Expected >= 26 applied migrations, found ${applied}. Aborting.`);
    process.exit(1);
  }

  if (schemaOnly) {
    console.log('Done (schema-only). Tables:');
    console.log(psql(target, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;"));
    return;
  }

  console.log('3/4 Copying data (TRUNCATE-safe per-table COPY, FK order)…');
  const source = (process.env.SOURCE_DATABASE_URL || '').trim();
  if (!source) {
    console.error('Set SOURCE_DATABASE_URL to the database to copy rows from.');
    process.exit(1);
  }
  const os = require('os');
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-supabase-'));
  let total = 0;
  for (const table of TABLES_IN_FK_ORDER) {
    const csv = path.join(tmp, `${table}.csv`);
    sh('psql', [source, '-c', `\\copy (SELECT * FROM public."${table}") TO '${csv}' WITH CSV`]);
    const count = Number(psql(source, `SELECT count(*) FROM public."${table}";`) || 0);
    if (count === 0) {
      console.log(`    ${table}: 0 rows (skipped)`);
      continue;
    }
    const cols = psql(source, `SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}';`);
    sh('psql', [target, '-c', `TRUNCATE public."${table}" RESTART IDENTITY CASCADE`]);
    sh('psql', [target, '-c', `\\copy public."${table}" (${cols}) FROM '${csv}' WITH CSV`]);
    // Keep sequences ahead of restored ids.
    try {
      const seq = psql(target, `SELECT pg_get_serial_sequence('public."${table}"', 'id');`);
      if (seq) sh('psql', [target, '-c', `SELECT setval('${seq}', COALESCE((SELECT max(id) FROM public."${table}"), 1));`]);
    } catch { /* tables without an id sequence */ }
    total += count;
    console.log(`    ${table}: ${count} rows`);
  }

  console.log('4/4 Verifying row counts…');
  for (const table of TABLES_IN_FK_ORDER) {
    const n = psql(target, `SELECT count(*) FROM public."${table}";`);
    console.log(`    ${table}: ${n}`);
  }
  console.log(`Migration complete. ${total} rows copied.`);
  console.log('Next: set DATABASE_URL in the deployed backend env, restart it, and test /api/plans + login.');
}

main();
