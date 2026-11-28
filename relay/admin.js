#!/usr/bin/env node
// Relay admin: add users. Prints the token ONCE; only a hash is stored.
//   node relay/admin.js add-user himnish
//   node relay/admin.js list-users
//   node relay/admin.js remove-user himnish
//   node relay/admin.js suspend <user> [reason] | unsuspend <user> | reports   (add --remote <url> with ADMIN_TOKEN set to reach a running relay)
//   node relay/admin.js stats          (daily counters and weekly active links; counts only)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA, { recursive: true });
const f = path.join(DATA, 'users.json');
const read = () => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const write = (v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const argv = process.argv.slice(2);
const ri = argv.indexOf('--remote');
const REMOTE = ri >= 0 ? argv.splice(ri, 2)[1] : null; // a running relay's address; the token comes from ADMIN_TOKEN, never from argv
const [cmd, name, ...restArgs] = argv;

// suspend / unsuspend / reports. A running relay owns its data in memory, so reach it over HTTP (--remote); only edit files when it's stopped.
async function operator() {
  if (REMOTE) {
    const token = process.env.ADMIN_TOKEN;
    if (!token) { console.error('set ADMIN_TOKEN in the environment (not on the command line)'); process.exit(1); }
    const base = REMOTE.replace(/^ws/, 'http').replace(/\/+$/, '');
    const init = cmd === 'reports' ? { headers: { authorization: `Bearer ${token}` } }
      : { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ user: name, reason: restArgs.join(' ') }) };
    const r = await fetch(`${base}/v1/admin/${cmd === 'reports' ? 'reports' : cmd}`, init);
    console.log(r.status === 200 ? JSON.stringify(await r.json(), null, 2) : `relay answered ${r.status}`);
    return process.exit(r.status === 200 ? 0 : 1);
  }
  try {
    const pid = Number(JSON.parse(fs.readFileSync(path.join(DATA, 'relay.pid'), 'utf8')).pid);
    process.kill(pid, 0);
    console.error(`a relay is running on this data folder (pid ${pid}). Use: ADMIN_TOKEN=... node relay/admin.js --remote http://127.0.0.1:<port> ${cmd} ...`);
    process.exit(1);
  } catch { /* no running relay: safe to edit the files */ }
  const { FileKV } = await import('./kv-file.js');
  const kv = new FileKV(DATA);
  if (cmd === 'reports') console.log(JSON.stringify(kv.list('report:').map(([, r]) => r), null, 2));
  else if (cmd === 'suspend') { kv.put('suspended:' + name, { at: Date.now(), reason: restArgs.join(' ').slice(0, 200) }); console.log(`suspended ${name}`); }
  else { kv.del('suspended:' + name); console.log(`unsuspended ${name}`); }
}

if (cmd === 'add-user') {
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(name || '')) { console.error('usage: add-user <name> (letters, digits, . _ -)'); process.exit(1); }
  const users = read();
  if (users[name]) { console.error(`user "${name}" already exists (remove it first to reissue a token)`); process.exit(1); }
  const token = crypto.randomBytes(24).toString('base64url');
  users[name] = crypto.createHash('sha256').update(token).digest('hex');
  write(users);
  console.log(`user: ${name}\ntoken: ${token}\n(share this token with ${name} privately; it will not be shown again)`);
} else if (cmd === 'list-users') {
  console.log(Object.keys(read()).join('\n') || '(none)');
} else if (cmd === 'remove-user') {
  const users = read(); delete users[name]; write(users); console.log(`removed ${name}`);
} else if (cmd === 'suspend' || cmd === 'unsuspend' || cmd === 'reports') {
  if (cmd !== 'reports' && !/^[a-zA-Z0-9._-]{1,40}$/.test(name || '')) { console.error(`usage: admin.js [--remote <url>] ${cmd} <user>${cmd === 'suspend' ? ' [reason]' : ''}`); process.exit(1); }
  await operator();
} else if (cmd === 'stats') {
  // Daily counters and weekly active links, from this data dir. Counts only: no names, labels or message text.
  const { FileKV } = await import('./kv-file.js');
  const { statsReport } = await import('./core.js');
  console.log(JSON.stringify(statsReport(new FileKV(DATA)), null, 2));
} else {
  console.error('usage: admin.js add-user|list-users|remove-user [name]  |  stats'); process.exit(1);
}
