#!/usr/bin/env node
// Relay admin: add users. Prints the token ONCE; only a hash is stored.
//   node relay/admin.js add-user himnish
//   node relay/admin.js list-users
//   node relay/admin.js remove-user himnish
//   node relay/admin.js stats          (daily counters and weekly active links; counts only)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA, { recursive: true });
const f = path.join(DATA, 'users.json');
const read = () => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const write = (v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const [cmd, name] = process.argv.slice(2);

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
} else if (cmd === 'stats') {
  // Daily counters and weekly active links, from this data dir. Counts only: no names, labels or message text.
  const { FileKV } = await import('./kv-file.js');
  const { statsReport } = await import('./core.js');
  console.log(JSON.stringify(statsReport(new FileKV(DATA)), null, 2));
} else {
  console.error('usage: admin.js add-user|list-users|remove-user [name]  |  stats'); process.exit(1);
}
