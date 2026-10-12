// Two drivers with the same small interface: query(sql, params), exec(sql), transaction(fn(q)).
//   pgDriver    - a real PostgreSQL server (the pg package), used in production
//   pgliteDriver - PGlite, PostgreSQL running inside Node.js, used by the tests (no server needed)

export async function pgDriver(connectionString, { max = 10 } = {}) {
  const pg = (await import('pg')).default;
  // COUNT / SUM come back as bigint / numeric; the app expects plain numbers (as SQLite gives).
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => parseFloat(v));
  const pool = new pg.Pool({ connectionString, max });
  const wrap = (client) => ({
    query: (sql, params) => client.query(sql, params),
    exec: (sql) => client.query(sql),
  });
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* connection already lost */ }
        throw error;
      } finally {
        client.release();
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
