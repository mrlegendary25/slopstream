// Unit tests for client-side helpers. No network. Run: node test/unit.js
process.env.SLOPSTREAM_KEYCHAIN = 'off';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, MIGRATIONS } from '../relay/migrations.js';
import { FileKV } from '../relay/kv-file.js';
import { MemKV } from '../relay/kv-mem.js';
import { RelayCore, configFromEnv } from '../relay/core.js';
import { ERRORS, RelayError, explain } from '../bridge/errors.js';
import { VERSION, cmpVersion } from '../bridge/version.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name, extra); } };

// --- error catalog ---
const core = fs.readFileSync(new URL('../relay/core.js', import.meta.url), 'utf8');
const codes = new Set();
for (const re of [/err\('([a-z_]+)'/g, /code: '([a-z_]+)'/g, /nack\('([a-z_]+)/g, /nack\(`([a-z_]+)/g]) {
  for (const m of core.matchAll(re)) codes.add(m[1]);
}
// nack(cond ? 'a' : 'b'): take every quoted word inside the call
for (const call of core.matchAll(/nack\(([^;]*?)\);/g)) for (const m of call[1].matchAll(/'([a-z_]+)'/g)) codes.add(m[1]);
check('found the relay error codes to check', codes.size >= 25 && codes.has('ambiguous_target'), [...codes].join(','));
const missing = [...codes].filter(c => !ERRORS[c]);
check('every relay error code has a catalog entry', missing.length === 0, missing.join(','));
for (const c of ['timeout', 'relay_disconnected', 'unreachable']) check(`bridge-side reason ${c} has an entry`, !!ERRORS[c]);
check('every entry has a message and a next step', Object.values(ERRORS).every(e => e.msg && e.fix));

const e1 = explain('group_full', 'this group already has the maximum of 3 chats');
check('explain uses the relay message when given', e1.includes('maximum of 3 chats'), e1);
check('explain always ends with a next step', Object.keys(ERRORS).every(c => /\n  → .+/.test(explain(c))));
check('explain handles an unknown code', /→/.test(explain('brand_new_code', 'something odd')) && /something odd/i.test(explain('brand_new_code', 'something odd')));
check('explain ignores a message that is just the code', !explain('peer_offline', 'peer_offline').includes('peer_offline'));
check('RelayError carries the code', new RelayError('auth', 'x').code === 'auth');

// --- versions ---
check('cmpVersion: 0.10.0 > 0.9.9', cmpVersion('0.10.0', '0.9.9') === 1);
check('cmpVersion: equal', cmpVersion('1.2.3', '1.2.3') === 0);
check('cmpVersion: older is -1', cmpVersion('0.2.1', '0.3.0') === -1);
check('cmpVersion: pre-release suffix ignored', cmpVersion('0.3.0-beta.1', '0.3.0') === 0);
check('cmpVersion: garbage counts as 0.0.0', cmpVersion('nope', '0.0.1') === -1 && cmpVersion(undefined, '0.0.0') === 0);
check('VERSION is read from package.json', VERSION === JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);

// --- migrations ---
{
  const ran = [];
  const kv = new MemKV();
  const list = [() => ran.push(1), (k) => { ran.push(2); k.put('x', 1); }, () => ran.push(3)];
  migrate(kv, list);
  check('migrate runs pending steps in order and records schema', ran.join() === '1,2,3' && kv.get('schema') === 3);
  migrate(kv, list);
  check('migrate is a no-op when up to date', ran.length === 3);

  const kv2 = new MemKV(); const seen = []; let boom = true;
  const list2 = [() => seen.push('a'), () => { if (boom) throw new Error('crash'); seen.push('b'); }, () => seen.push('c')];
  try { migrate(kv2, list2); } catch { /* expected */ }
  check('migrate records schema after each step before a crash', kv2.get('schema') === 1);
  boom = false; migrate(kv2, list2);
  check('migrate resumes after a failed step', seen.join() === 'a,b,c' && kv2.get('schema') === 3);

  let msg = '';
  try { migrate(new MemKV({ schema: 99 }), list); } catch (e) { msg = e.message; }
  check('migrate refuses data from a newer schema', /newer slopstream \(schema 99\)/.test(msg), msg);
  const fresh = new MemKV(); new RelayCore({ kv: fresh, config: configFromEnv({}) });
  check('RelayCore on a fresh store sets schema 1', fresh.get('schema') === MIGRATIONS.length && MIGRATIONS.length === 1);
}

// --- audit rotation ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-'));
  const kv = new FileKV(dir, { auditMaxBytes: 200 });
  for (let i = 0; i < 100; i++) kv.appendAudit({ ev: 'x', n: i, pad: 'y'.repeat(20) });
  const files = fs.readdirSync(dir);
  const rotated = files.filter(f => /^audit-\d{8}T\d{6}.*\.jsonl$/.test(f));
  check('FileKV rotates audit.jsonl past the size limit', rotated.length === 1, files.join());
  check('a fresh audit.jsonl is not created until the next write', !files.includes('audit.jsonl'));
  kv.appendAudit({ ev: 'after' });
  check('writes continue in a new audit.jsonl', fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').includes('"after"'));

  const old = path.join(dir, 'audit-20200101T000000.jsonl');
  fs.writeFileSync(old, '{}\n');
  const t = new Date(Date.now() - 40 * 86400000); fs.utimesSync(old, t, t);
  new FileKV(dir);
  check('FileKV deletes rotated audit files older than retention', !fs.existsSync(old) && fs.existsSync(path.join(dir, rotated[0])));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
