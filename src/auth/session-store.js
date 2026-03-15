const session = require('express-session');
const { getDb } = require('../db/database');

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    )`);
    this._cleanupInterval = setInterval(() => {
      try { getDb().prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now()); } catch {}
    }, 900000);
  }

  get(sid, cb) {
    try {
      const row = getDb().prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000;
      const expired = Date.now() + maxAge;
      getDb().prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expired);
      cb?.(null);
    } catch (err) { cb?.(err); }
  }

  destroy(sid, cb) {
    try {
      getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb?.(null);
    } catch (err) { cb?.(err); }
  }

  clear(cb) {
    try {
      getDb().prepare('DELETE FROM sessions').run();
      cb?.(null);
    } catch (err) { cb?.(err); }
  }
}

module.exports = SqliteSessionStore;
