const path = require('path');
const crypto = require('crypto');
const util = require('util');
const Database = require('better-sqlite3');

const scrypt = util.promisify(crypto.scrypt);
const db = new Database(path.join(__dirname, '..', 'database.sqlite'));
const SESSION_INACTIVITY_TTL_SECONDS = 7 * 24 * 60 * 60;

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    last_seen_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    machine_name TEXT NOT NULL DEFAULT '',
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (user_id, machine_name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_queue_plans (
    user_id INTEGER NOT NULL,
    machine_name TEXT NOT NULL DEFAULT '',
    source_root TEXT NOT NULL DEFAULT '',
    queue_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (user_id, machine_name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_root TEXT NOT NULL,
    out_root TEXT NOT NULL,
    total_files INTEGER NOT NULL DEFAULT 0,
    encoded INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    source_bytes INTEGER NOT NULL DEFAULT 0,
    output_bytes INTEGER NOT NULL DEFAULT 0,
    savings_bytes INTEGER NOT NULL DEFAULT 0,
    encode_seconds INTEGER NOT NULL DEFAULT 0,
    video_seconds INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`);

try {
  db.exec("ALTER TABLE job_runs ADD COLUMN updated_at INTEGER");
} catch (error) {
  if (!String(error.message).includes('duplicate column name')) throw error;
}
db.exec("UPDATE job_runs SET updated_at = COALESCE(updated_at, finished_at, started_at) WHERE updated_at IS NULL");

try {
  db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER");
} catch (error) {
  if (!String(error.message).includes('duplicate column name')) throw error;
}
db.exec("UPDATE sessions SET last_seen_at = COALESCE(last_seen_at, created_at, strftime('%s', 'now')) WHERE last_seen_at IS NULL");


function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some(column => column.name === columnName);
}

function migrateScopedTable(tableName, valueColumnsSql, extraColumnsSql) {
  if (hasColumn(tableName, 'machine_name')) return;
  const tempTable = `${tableName}_scoped`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tempTable} (
      user_id INTEGER NOT NULL,
      machine_name TEXT NOT NULL DEFAULT '',
      ${extraColumnsSql},
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (user_id, machine_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    INSERT INTO ${tempTable} (user_id, machine_name, ${valueColumnsSql}, updated_at)
    SELECT user_id, '', ${valueColumnsSql}, updated_at FROM ${tableName};
    DROP TABLE ${tableName};
    ALTER TABLE ${tempTable} RENAME TO ${tableName};
  `);
}

migrateScopedTable('user_settings', 'settings_json', "settings_json TEXT NOT NULL DEFAULT '{}'" );
migrateScopedTable(
  'user_queue_plans',
  'source_root, queue_json',
  "source_root TEXT NOT NULL DEFAULT '', queue_json TEXT NOT NULL DEFAULT '[]'"
);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { hash: hash.toString('hex'), salt };
}

async function verifyPassword(password, storedHash, salt) {
  const hash = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), hash);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sessionCutoff(now = Math.floor(Date.now() / 1000)) {
  return now - SESSION_INACTIVITY_TTL_SECONDS;
}

function purgeExpiredSessions(now = Math.floor(Date.now() / 1000)) {
  return db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(sessionCutoff(now)).changes;
}

function getUserById(userId) {
  return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId) || null;
}

function getUserByUsername(username) {
  return db.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(username) || null;
}

async function createUser(username, password) {
  const { hash, salt } = await hashPassword(password);
  try {
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)'
    ).run(username, hash, salt);
    return { id: result.lastInsertRowid, username };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new Error('Username already taken');
    }
    throw error;
  }
}

async function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash, user.salt);
  return ok ? { id: user.id, username: user.username } : null;
}

function createSession(userId) {
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)').run(token, userId, now, now);
  return token;
}

function getSession(token) {
  const now = Math.floor(Date.now() / 1000);
  purgeExpiredSessions(now);
  const session = db.prepare(`
    SELECT s.token, s.user_id, u.username
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.last_seen_at >= ?
  `).get(token, sessionCutoff(now)) || null;
  if (!session) return null;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(now, token);
  return session;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getUserSettings(userId, machineName = '') {
  const row = db.prepare('SELECT settings_json FROM user_settings WHERE user_id = ? AND machine_name = ?').get(userId, machineName)
    || db.prepare("SELECT settings_json FROM user_settings WHERE user_id = ? AND machine_name = ''").get(userId);
  if (!row) return null;
  try {
    return JSON.parse(row.settings_json || '{}');
  } catch {
    return null;
  }
}

function saveUserSettings(userId, machineName = '', settings) {
  const json = JSON.stringify(settings || {});
  db.prepare(`
    INSERT INTO user_settings (user_id, machine_name, settings_json, updated_at)
    VALUES (?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(user_id, machine_name) DO UPDATE SET
      settings_json = excluded.settings_json,
      updated_at = strftime('%s', 'now')
  `).run(userId, machineName, json);
}

function getUserQueuePlan(userId, machineName = '') {
  const row = db.prepare('SELECT source_root, queue_json, updated_at FROM user_queue_plans WHERE user_id = ? AND machine_name = ?').get(userId, machineName)
    || db.prepare("SELECT source_root, queue_json, updated_at FROM user_queue_plans WHERE user_id = ? AND machine_name = ''").get(userId);
  if (!row) return null;
  let items = [];
  try {
    items = JSON.parse(row.queue_json || '[]');
  } catch {
    items = [];
  }
  return {
    sourceRoot: row.source_root || '',
    queue: Array.isArray(items) ? items : [],
    updatedAt: row.updated_at ? Number(row.updated_at) : null,
  };
}

function saveUserQueuePlan(userId, machineName = '', sourceRoot, queue) {
  const json = JSON.stringify(Array.isArray(queue) ? queue : []);
  db.prepare(`
    INSERT INTO user_queue_plans (user_id, machine_name, source_root, queue_json, updated_at)
    VALUES (?, ?, ?, ?, strftime('%s', 'now'))
    ON CONFLICT(user_id, machine_name) DO UPDATE SET
      source_root = excluded.source_root,
      queue_json = excluded.queue_json,
      updated_at = strftime('%s', 'now')
  `).run(userId, machineName, sourceRoot || '', json);
}

function clearUserQueuePlan(userId, machineName = '') {
  db.prepare('DELETE FROM user_queue_plans WHERE user_id = ? AND machine_name = ?').run(userId, machineName);
}

function createJobRun(userId, snapshot) {
  const result = db.prepare(`
    INSERT INTO job_runs (
      user_id, status, source_root, out_root, total_files,
      encoded, skipped, failed, source_bytes, output_bytes,
      savings_bytes, encode_seconds, video_seconds, started_at, finished_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    snapshot.status,
    snapshot.sourceRoot,
    snapshot.outRoot,
    snapshot.totalFiles,
    snapshot.encoded,
    snapshot.skipped,
    snapshot.failed,
    snapshot.sourceBytes,
    snapshot.outputBytes,
    snapshot.savingsBytes,
    snapshot.encodeSeconds,
    snapshot.videoSeconds,
    snapshot.startedAt,
    snapshot.finishedAt,
    Math.floor(Date.now() / 1000),
  );
  return result.lastInsertRowid;
}

function updateJobRun(runId, snapshot) {
  db.prepare(`
    UPDATE job_runs
    SET status = ?, total_files = ?, encoded = ?, skipped = ?, failed = ?,
        source_bytes = ?, output_bytes = ?, savings_bytes = ?,
        encode_seconds = ?, video_seconds = ?, finished_at = ?,
        updated_at = strftime('%s', 'now')
    WHERE id = ?
  `).run(
    snapshot.status,
    snapshot.totalFiles,
    snapshot.encoded,
    snapshot.skipped,
    snapshot.failed,
    snapshot.sourceBytes,
    snapshot.outputBytes,
    snapshot.savingsBytes,
    snapshot.encodeSeconds,
    snapshot.videoSeconds,
    snapshot.finishedAt,
    runId,
  );
}

function vacuumDatabase() {
  db.exec('VACUUM');
}

function clearStoppedRunFailures() {
  return db.prepare(`
    UPDATE job_runs
    SET failed = 0,
        updated_at = strftime('%s', 'now')
    WHERE status = 'stopped' AND failed > 0
  `).run().changes;
}

function listUsers() {
  const now = Math.floor(Date.now() / 1000);
  purgeExpiredSessions(now);
  return db.prepare(`
    SELECT
      u.id,
      u.username,
      u.created_at,
      COUNT(DISTINCT s.token) AS sessions_count
    FROM users u
    LEFT JOIN sessions s ON s.user_id = u.id
    GROUP BY u.id, u.username, u.created_at
    ORDER BY LOWER(u.username) ASC
  `).all().map(row => ({
    id: Number(row.id),
    username: row.username,
    createdAt: row.created_at ? Number(row.created_at) : null,
    sessionsCount: Number(row.sessions_count || 0),
  }));
}

async function updateUserPassword(username, password) {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) throw new Error('User not found');
  const { hash, salt } = await hashPassword(password);
  db.prepare(`
    UPDATE users
    SET password_hash = ?, salt = ?
    WHERE id = ?
  `).run(hash, salt, user.id);
  return { id: Number(user.id), username };
}

function deleteUserByUsername(username) {
  return db.prepare('DELETE FROM users WHERE username = ?').run(username).changes;
}

function getAppMeta(key) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setAppMeta(key, value) {
  db.prepare(`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = strftime('%s', 'now')
  `).run(key, String(value));
}

function getAppVersion(fallback = '') {
  return getAppMeta('app_version') || fallback;
}

function setAppVersion(version) {
  setAppMeta('app_version', version);
}

function getLifetimeStats() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS runs_total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS runs_done,
      SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) AS runs_stopped,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS runs_error,
      SUM(CASE WHEN (encoded + skipped + failed) > 0 THEN 1 ELSE 0 END) AS runs_with_processed_files,
      COALESCE(SUM(total_files), 0) AS discovered_total,
      COALESCE(SUM(encoded), 0) AS encoded_total,
      COALESCE(SUM(skipped), 0) AS skipped_total,
      COALESCE(SUM(failed), 0) AS failed_total,
      COALESCE(SUM(source_bytes), 0) AS source_bytes,
      COALESCE(SUM(output_bytes), 0) AS output_bytes,
      COALESCE(SUM(savings_bytes), 0) AS savings_bytes,
      COALESCE(SUM(encode_seconds), 0) AS encode_seconds,
      COALESCE(SUM(video_seconds), 0) AS video_seconds,
      MIN(started_at) AS first_started_at,
      MAX(updated_at) AS last_activity_at
    FROM job_runs
  `).get();

  const sourceBytes = Number(totals.source_bytes || 0);
  const outputBytes = Number(totals.output_bytes || 0);
  const savingsBytes = Number(totals.savings_bytes || 0);
  const dbSize = Number(db.prepare('PRAGMA page_count').get().page_count || 0) * Number(db.prepare('PRAGMA page_size').get().page_size || 0);
  const encodedTotal = Number(totals.encoded_total || 0);
  const skippedTotal = Number(totals.skipped_total || 0);
  const failedTotal = Number(totals.failed_total || 0);
  const processedTotal = encodedTotal + skippedTotal + failedTotal;
  const discoveredTotal = Number(totals.discovered_total || 0);
  const encodeSeconds = Number(totals.encode_seconds || 0);
  const videoSeconds = Number(totals.video_seconds || 0);

  return {
    runsTotal: Number(totals.runs_total || 0),
    runsDone: Number(totals.runs_done || 0),
    runsStopped: Number(totals.runs_stopped || 0),
    runsError: Number(totals.runs_error || 0),
    filesTotal: processedTotal,
    discoveredTotal: discoveredTotal,
    encodedTotal: encodedTotal,
    skippedTotal: skippedTotal,
    failedTotal: failedTotal,
    sourceBytes,
    outputBytes,
    savingsBytes,
    dbSize,
    savingsPct: sourceBytes > 0 ? (savingsBytes / sourceBytes) * 100 : null,
    averageSavingsBytes: encodedTotal > 0 ? Math.trunc(savingsBytes / encodedTotal) : null,
    completedSpeedX: encodeSeconds > 0 ? videoSeconds / encodeSeconds : null,
    averageBitrateKbps: videoSeconds > 0 ? (outputBytes * 8 / 1000) / videoSeconds : null,
    averageFilesPerRun: Number(totals.runs_with_processed_files || 0) > 0
      ? processedTotal / Number(totals.runs_with_processed_files || 0)
      : null,
    encodeSeconds,
    videoSeconds,
    firstStartedAt: totals.first_started_at ? Number(totals.first_started_at) : null,
    lastActivityAt: totals.last_activity_at ? Number(totals.last_activity_at) : null,
  };
}

module.exports = {
  getUserById,
  getUserByUsername,
  listUsers,
  createUser,
  verifyUser,
  updateUserPassword,
  deleteUserByUsername,
  createSession,
  getSession,
  deleteSession,
  purgeExpiredSessions,
  getUserSettings,
  saveUserSettings,
  getUserQueuePlan,
  saveUserQueuePlan,
  clearUserQueuePlan,
  createJobRun,
  updateJobRun,
  clearStoppedRunFailures,
  vacuumDatabase,
  getLifetimeStats,
  getAppVersion,
  setAppVersion,
};
