// KV store for the Node relay host: JSON files in DATA_DIR.
// users.json and links.json keep their historical format (relay/admin.js edits users.json while the relay runs,
// so `users` is re-read from disk on every get). Everything else lives in state.json.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };

export class FileKV {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.usersFile = path.join(dir, 'users.json');
    this.linksFile = path.join(dir, 'links.json');
    this.auditFile = path.join(dir, 'audit.jsonl');
    this.stateFile = path.join(dir, 'state.json');
    this.state = readJson(this.stateFile, {});
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
  appendAudit(o) { fs.appendFileSync(this.auditFile, JSON.stringify(o) + '\n'); }
}
