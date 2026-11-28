// KV store for the Node relay host: JSON files in DATA_DIR.
// users.json and links.json keep their historical format (relay/admin.js edits users.json while the relay runs,
// so `users` is re-read from disk on every get). Everything else lives in state.json.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };

export class FileKV {
  constructor(dir, { auditMaxBytes = 10 * 1024 * 1024, auditRetentionDays = 30 } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir; this.auditMaxBytes = auditMaxBytes; this.auditRetentionMs = auditRetentionDays * 86400000; this.appends = 0;
    this.usersFile = path.join(dir, 'users.json');
    this.linksFile = path.join(dir, 'links.json');
    this.auditFile = path.join(dir, 'audit.jsonl');
    this.stateFile = path.join(dir, 'state.json');
    this.state = readJson(this.stateFile, {});
    this.pruneAudit();
  }
  get(k) {
    if (k === 'users') return readJson(this.usersFile, {});
    if (k === 'links') return readJson(this.linksFile, []);
    const v = this.state[k];
    return v === undefined ? undefined : structuredClone(v);
  }
  put(k, v) {
    if (k === 'users') return writeJson(this.usersFile, v);
    if (k === 'links') return writeJson(this.linksFile, v);
    this.state[k] = structuredClone(v);
    writeJson(this.stateFile, this.state);
  }
  del(k) {
    if (k === 'users') return writeJson(this.usersFile, {});
    if (k === 'links') return writeJson(this.linksFile, []);
    delete this.state[k];
    writeJson(this.stateFile, this.state);
  }
  list(prefix) {
    return Object.entries(this.state).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]);
  }
  appendAudit(o) {
    fs.appendFileSync(this.auditFile, JSON.stringify(o) + '\n');
    if (++this.appends % 100 === 0) this.rotateAudit();
  }
  readAudit(sinceMs, match, limit) {
    const files = [this.auditFile];
    try { files.push(...fs.readdirSync(this.dir).filter(f => /^audit-.*\.jsonl$/.test(f)).sort().reverse().map(f => path.join(this.dir, f))); } catch { /* none */ }
    const out = [];
    for (const f of files) {                       // current file first, then rotated ones, newest first
      let raw = ''; try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const lines = raw.split('\n');
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue;
        let e; try { e = JSON.parse(lines[i]); } catch { continue; }
        if (Date.parse(e.ts) < sinceMs) return out; // everything earlier is older still
        if (match(e)) out.push(e);
      }
      if (out.length >= limit) break;
    }
    return out;
  }
  // Past the size limit the live file is renamed to audit-<UTC time>.jsonl and a new one starts.
  rotateAudit() {
    try {
      if (fs.statSync(this.auditFile).size <= this.auditMaxBytes) return;
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
      let dest = path.join(this.dir, `audit-${stamp}.jsonl`);
      for (let i = 1; fs.existsSync(dest); i++) dest = path.join(this.dir, `audit-${stamp}-${i}.jsonl`);
      fs.renameSync(this.auditFile, dest);
      this.pruneAudit();
    } catch { /* the audit log must never break the relay */ }
  }
  // Rotated files older than the retention period are deleted.
  pruneAudit() {
    try {
      const cutoff = Date.now() - this.auditRetentionMs;
      for (const f of fs.readdirSync(this.dir)) {
        if (!/^audit-.*\.jsonl$/.test(f)) continue;
        const full = path.join(this.dir, f);
        if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
      }
    } catch { /* best effort */ }
  }
}
