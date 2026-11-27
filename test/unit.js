// Unit tests for client-side helpers. No network. Run: node test/unit.js
process.env.SLOPSTREAM_KEYCHAIN = 'off';
import fs from 'node:fs';
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
