// The KV contract (see dev plan §2.1) on Durable Object SQLite storage. Synchronous, like the Node FileKV.
export class SqlKV {
  constructor(sql, { auditRetentionDays = 30 } = {}) {
    this.sql = sql; this.n = 0; this.retentionMs = auditRetentionDays * 86400000;
    sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, data TEXT NOT NULL)');
  }
  get(k) { const r = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray(); return r.length ? JSON.parse(r[0].v) : undefined; }
  put(k, v) { this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v)); }
  del(k) { this.sql.exec('DELETE FROM kv WHERE k = ?', k); }
  list(p) { return this.sql.exec('SELECT k, v FROM kv WHERE substr(k, 1, ?) = ?', p.length, p).toArray().map(r => [r.k, JSON.parse(r.v)]); }
  appendAudit(o) {
    this.sql.exec('INSERT INTO audit (ts, data) VALUES (?, ?)', Date.now(), JSON.stringify(o));
    if (++this.n % 200 === 0) this.sql.exec('DELETE FROM audit WHERE ts < ?', Date.now() - this.retentionMs);
  }
}
