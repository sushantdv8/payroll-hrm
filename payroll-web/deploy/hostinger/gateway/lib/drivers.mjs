// Two drivers with the same small interface: query(sql, params), exec(sql), transaction(fn(q)).
//   pgDriver    - a real PostgreSQL server (the pg package), used in production
//   pgliteDriver - PGlite, PostgreSQL running inside Node.js, used by the tests (no server needed)

// lock: false is only for test/lock-test.mjs, which shows what happens without the write lock.
export async function pgDriver(connectionString, { max = 10, lock = true } = {}) {
  const pg = (await import('pg')).default;
  // COUNT / SUM come back as bigint / numeric; the app expects plain numbers (as SQLite gives).
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => parseFloat(v));
  const pool = new pg.Pool({ connectionString, max, keepAlive: true, connectionTimeoutMillis: 15000 });
  // If PostgreSQL restarts or drops an idle connection the pool reports it here; without a listener Node.js would stop the gateway.
  pool.on('error', (error) => console.error('PostgreSQL dropped an idle connection (a new one is opened when needed):', error.message));
  const wrap = (client) => ({
    query: (sql, params) => client.query(sql, params),
    exec: (sql) => client.query(sql),
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      const onError = () => { broken = true; };
      client.on('error', onError);
      try {
        await client.query('BEGIN');
        // SQLite runs one write batch at a time, and the app's "write guard" (check a revision, then write) depends on that.
        // PostgreSQL would let two batches pass the same check together, so batches take turns on one transaction lock.
        if (lock) await client.query('SELECT pg_advisory_xact_lock(7240001)');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { broken = true; /* connection already lost */ }
        throw error;
      } finally {
        client.removeListener('error', onError);
        client.release(broken ? true : undefined); // a lost connection is thrown away, not reused
      }
    },
    close: () => pool.end(),
  };
}

export async function pgliteDriver(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  const wrap = (q) => ({ query: (sql, params) => q.query(sql, params), exec: (sql) => q.exec(sql) });
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}
