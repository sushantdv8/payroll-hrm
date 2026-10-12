// Local SQLite store: machines, the user list last read from each machine, and every punch ever downloaded.
// Punches are kept even after a machine is removed or its memory is cleared; re-downloading never duplicates them.
import { DatabaseSync } from 'node:sqlite';

const now = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// Name for a punch: the name on the same machine, else the same user ID's name on any machine.
const LOG_ROWS = `
  SELECT l.id, l.device_id, l.user_id, l.ts, l.verify, l.punch,
    COALESCE(d.name, 'Machine ' || l.device_id) AS device, COALESCE(dn.name, an.name, '') AS name
  FROM logs l
  LEFT JOIN devices d ON d.id = l.device_id
  LEFT JOIN (SELECT device_id, user_id, MAX(name) AS name FROM users WHERE name <> '' GROUP BY device_id, user_id) dn
    ON dn.device_id = l.device_id AND dn.user_id = l.user_id
  LEFT JOIN (SELECT user_id, MAX(name) AS name FROM users WHERE name <> '' GROUP BY user_id) an ON an.user_id = l.user_id
  WHERE l.ts >= :from AND l.ts <= :to AND (:device = 0 OR l.device_id = :device)`;
const SEARCH = `(:q = '' OR user_id = :q OR name LIKE '%' || :q || '%')`;
const USER_ORDER = `CAST(user_id AS INTEGER), user_id`;

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, ip TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 4370,
      protocol TEXT NOT NULL DEFAULT 'auto', comm_key INTEGER NOT NULL DEFAULT 0, machine_no INTEGER NOT NULL DEFAULT 1,
      info TEXT, status TEXT NOT NULL DEFAULT 'new', message TEXT, checked_at TEXT, synced_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      device_id INTEGER NOT NULL, uid INTEGER NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      privilege INTEGER NOT NULL DEFAULT 0, card TEXT, grp TEXT, has_password INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL, PRIMARY KEY (device_id, uid)
    );
    CREATE INDEX IF NOT EXISTS users_user_id ON users (user_id);
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL, user_id TEXT NOT NULL, ts TEXT NOT NULL,
      verify INTEGER, punch INTEGER, fetched_at TEXT NOT NULL,
      UNIQUE (device_id, user_id, ts)
    );
    CREATE INDEX IF NOT EXISTS logs_ts ON logs (ts);
    CREATE TABLE IF NOT EXISTS syncs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL, kind TEXT NOT NULL,
      started_at TEXT NOT NULL, seconds REAL, ok INTEGER NOT NULL,
      users INTEGER, logs INTEGER, new_logs INTEGER, message TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `);

  const tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const deviceRow = (r) => r && ({
    id: r.id, name: r.name, ip: r.ip, port: r.port, protocol: r.protocol, commKey: r.comm_key, machineNo: r.machine_no,
    info: r.info ? JSON.parse(r.info) : null, status: r.status, message: r.message,
    checkedAt: r.checked_at, syncedAt: r.synced_at,
    storedLogs: r.stored_logs ?? 0, lastPunch: r.last_punch ?? null, storedUsers: r.stored_users ?? 0,
  });
  const filter = (f) => ({
    from: `${f.from} 00:00:00`, to: `${f.to} 23:59:59`, device: Number(f.device) || 0, q: (f.q || '').trim(),
  });

  return {
    getSetting(key, fallback = null) {
      const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return r ? JSON.parse(r.value) : fallback;
    },
    setSetting(key, value) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value));
    },

    listDevices() {
      return db.prepare(`
        SELECT d.*, (SELECT COUNT(*) FROM logs l WHERE l.device_id = d.id) AS stored_logs,
          (SELECT MAX(ts) FROM logs l WHERE l.device_id = d.id) AS last_punch,
          (SELECT COUNT(*) FROM users u WHERE u.device_id = d.id) AS stored_users
        FROM devices d ORDER BY d.name COLLATE NOCASE, d.id`).all().map(deviceRow);
    },
    getDevice(id) {
      return deviceRow(db.prepare('SELECT * FROM devices WHERE id = ?').get(id));
    },
    addDevice(d) {
      const r = db.prepare(`INSERT INTO devices (name, ip, port, protocol, comm_key, machine_no, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(d.name, d.ip, d.port, d.protocol, d.commKey, d.machineNo, now());
      return Number(r.lastInsertRowid);
    },
    updateDevice(id, d) {
      db.prepare(`UPDATE devices SET name = ?, ip = ?, port = ?, protocol = ?, comm_key = ?, machine_no = ? WHERE id = ?`)
        .run(d.name, d.ip, d.port, d.protocol, d.commKey, d.machineNo, id);
    },
    // Removes the machine and its user list; its punches stay in the database.
    deleteDevice(id) {
      tx(() => {
        db.prepare('DELETE FROM users WHERE device_id = ?').run(id);
        db.prepare('DELETE FROM devices WHERE id = ?').run(id);
      });
    },
    setDeviceResult(id, { ok, message = null, info, synced = false }) {
      const t = now();
      db.prepare(`UPDATE devices SET status = ?, message = ?, checked_at = ?,
          info = COALESCE(?, info), synced_at = CASE WHEN ? THEN ? ELSE synced_at END WHERE id = ?`)
        .run(ok ? 'online' : 'error', message, t, info ? JSON.stringify(info) : null, synced ? 1 : 0, t, id);
    },

    saveUsers(deviceId, users) {
      const t = now();
      const insert = db.prepare(`INSERT OR REPLACE INTO users
        (device_id, uid, user_id, name, privilege, card, grp, has_password, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      tx(() => {
        db.prepare('DELETE FROM users WHERE device_id = ?').run(deviceId);
        for (const u of users) {
          insert.run(deviceId, u.uid, u.userId, u.name, u.privilege, u.card ? String(u.card) : '', u.group || '', u.hasPassword ? 1 : 0, t);
        }
      });
    },
    // Returns how many punches were new.
    saveLogs(deviceId, logs) {
      const t = now();
      const insert = db.prepare('INSERT OR IGNORE INTO logs (device_id, user_id, ts, verify, punch, fetched_at) VALUES (?, ?, ?, ?, ?, ?)');
      return tx(() => logs.reduce((n, l) => n + Number(insert.run(deviceId, l.userId, l.time, l.verify, l.punch, t).changes), 0));
    },
    addSync(row) {
      db.prepare(`INSERT INTO syncs (device_id, kind, started_at, seconds, ok, users, logs, new_logs, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.deviceId, row.kind, row.startedAt, row.seconds, row.ok ? 1 : 0, row.users ?? null, row.logs ?? null, row.newLogs ?? null, row.message ?? null);
    },
    history(limit = 200) {
      return db.prepare(`SELECT s.*, COALESCE(d.name, 'Machine ' || s.device_id) AS device FROM syncs s
        LEFT JOIN devices d ON d.id = s.device_id ORDER BY s.id DESC LIMIT ?`).all(limit);
    },

    queryLogs(f, { limit = 0, offset = 0 } = {}) {
      const p = filter(f);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM (${LOG_ROWS}) WHERE ${SEARCH}`).get(p).n;
      const rows = db.prepare(`SELECT * FROM (${LOG_ROWS}) WHERE ${SEARCH} ORDER BY ts DESC, id DESC
        ${limit ? 'LIMIT :limit OFFSET :offset' : ''}`).all(limit ? { ...p, limit, offset } : p);
      return { total, rows };
    },
    // First and last punch per person per day, across all machines (same user ID = same person).
    queryDaily(f) {
      return db.prepare(`SELECT user_id, MAX(name) AS name, substr(ts, 1, 10) AS day, MIN(ts) AS first, MAX(ts) AS last,
          COUNT(*) AS punches, GROUP_CONCAT(DISTINCT device) AS devices
        FROM (${LOG_ROWS}) WHERE ${SEARCH} GROUP BY user_id, day ORDER BY day DESC, ${USER_ORDER}`).all(filter(f));
    },
    queryUsers(f) {
      const q = (f.q || '').trim(), device = Number(f.device) || 0;
      return db.prepare(`SELECT u.*, COALESCE(d.name, 'Machine ' || u.device_id) AS device,
          (SELECT MAX(ts) FROM logs l WHERE l.user_id = u.user_id) AS last_punch
        FROM users u LEFT JOIN devices d ON d.id = u.device_id
        WHERE (:device = 0 OR u.device_id = :device) AND (:q = '' OR u.user_id = :q OR u.name LIKE '%' || :q || '%')
        ORDER BY CAST(u.user_id AS INTEGER), u.user_id, device`).all({ device, q });
    },
    totals() {
      return db.prepare(`SELECT (SELECT COUNT(*) FROM logs) AS logs, (SELECT COUNT(DISTINCT user_id) FROM users) AS people,
        (SELECT MIN(ts) FROM logs) AS first, (SELECT MAX(ts) FROM logs) AS last`).get();
    },
    close() { db.close(); },
  };
}
