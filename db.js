require('dotenv').config();
const { Pool } = require('pg');

// Production (Supabase) uses a single DATABASE_URL, e.g.
//   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
// Use the Session Pooler (port 5432): node-postgres relies on server-side
// prepared statements, which the transaction pooler (6543) cannot guarantee.
// Local development keeps working with the individual DB_* variables.
function buildPool() {
  const connectionString = (process.env.DATABASE_URL || '').trim();
  // DB_USE_LOCAL=1 lets the test harness (and any script that must pin an
  // exact database) force the DB_* path even when a DATABASE_URL is present in
  // the ambient environment. Without this, a developer whose .env points at
  // Supabase would silently run the isolated test databases against
  // production. Only a remote URL (Supabase) takes precedence over DB_*.
  const isRemote =
    process.env.DB_USE_LOCAL !== '1' &&
    !!connectionString &&
    !/localhost|127\.0\.0\.1|%2Flocalhost|%2Ftmp/i.test(connectionString);
  if (isRemote) {
    return new Pool({
      connectionString,
      // Supabase PostgreSQL requires SSL. The pooler terminates its own
      // certificate chain, so full verification is not possible from the
      // app host; traffic is still encrypted and authenticated by password.
      ssl: { rejectUnauthorized: false },
      // Fail fast instead of hanging a request forever if the pooler is
      // saturated, and recycle idle sockets before the pooler reaps them so
      // a fresh request never lands on a socket the server already closed.
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    });
  }
  return new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });
}

const pool = buildPool();

// The Supabase pooler closes idle server-side connections on its own schedule.
// node-postgres surfaces that as an 'error' event on the Pool; without a
// listener it becomes an unhandled 'error' event and takes the whole API
// process down mid-shift. Swallow it here — the pool discards the dead client
// and the next query transparently checks out a fresh connection.
pool.on('error', err => {
  console.error('Idle database client terminated by the pooler:', err.message || err);
});

// Startup probe only — never crash the process on require(). Callers that
// need the database will surface query errors themselves.
if (process.env.SKIP_DB_PROBE !== '1') {
  pool
    .query('SELECT 1')
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('Connection error', err.message || err));
}

module.exports = pool;