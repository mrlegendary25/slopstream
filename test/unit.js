// Unit tests for client-side helpers. No network. Run: node test/unit.js
process.env.SLOPSTREAM_KEYCHAIN = 'off';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { migrate, MIGRATIONS } from '../relay/migrations.js';
import { FileKV } from '../relay/kv-file.js';
import { MemKV } from '../relay/kv-mem.js';
import { RelayCore, configFromEnv } from '../relay/core.js';
import { detectAgents, chooseAgent, describeChoice } from '../bridge/agents.js';
import { makeSecretStore } from '../bridge/secrets.js';
import { saveConfig, loadConfig, secretAccount, deleteSecret } from '../bridge/config.js';
import { ERRORS, RelayError, explain } from '../bridge/errors.js';
import { VERSION, cmpVersion } from '../bridge/version.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name, extra); } };

// --- error catalog ---
const core = fs.readFileSync(new URL('../relay/core.js', import.meta.url), 'utf8');
const codes = new Set();
for (const re of [/\b(?:err|bad|fail)\('([a-z_]+)'/g, /code: '([a-z_]+)'/g, /nack\('([a-z_]+)/g, /nack\(`([a-z_]+)/g]) {
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

// --- secret store (fake `run`, never a real keychain) ---
{
  const TOKEN = 'sst_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
  // A fake OS store: remembers what was written by account, records every call.
  const fakeOs = (platform) => {
    const calls = []; const vault = new Map();
    const run = (cmd, args, input) => {
      calls.push({ cmd, args: [...args], input });
      if (platform === 'darwin') {
        if (args[0] === 'help') return { status: 0, stdout: '', stderr: '' };
        if (args[0] === '-i') { const m = /-a "([^"]+)" -w (\S+)/.exec(input || ''); if (!m) return { status: 1, stdout: '', stderr: 'bad' }; vault.set(m[1], m[2]); return { status: 0, stdout: '', stderr: '' }; }
        if (args[0] === 'find-generic-password') { const v = vault.get(args[args.indexOf('-a') + 1]); return v ? { status: 0, stdout: v + '\n', stderr: '' } : { status: 44, stdout: '', stderr: '' }; }
        if (args[0] === 'delete-generic-password') { vault.delete(args[args.indexOf('-a') + 1]); return { status: 0, stdout: '', stderr: '' }; }
      }
      if (platform === 'linux') {
        if (args[0] === '--version') return { status: 0, stdout: 'secret-tool 0.20', stderr: '' };
        const acct = args[args.indexOf('account') + 1];
        if (args[0] === 'store') { vault.set(acct, (input || '').trim()); return { status: 0, stdout: '', stderr: '' }; }
        if (args[0] === 'lookup') { const v = vault.get(acct); return v ? { status: 0, stdout: v, stderr: '' } : { status: 1, stdout: '', stderr: '' }; }
        if (args[0] === 'clear') { vault.delete(acct); return { status: 0, stdout: '', stderr: '' }; }
      }
      if (platform === 'win32') {
        if (args.includes('exit 0')) return { status: 0, stdout: '', stderr: '' };
        const script = args[args.length - 1];
        if (/Protect\(/.test(script) && !/Unprotect/.test(script)) return { status: 0, stdout: Buffer.from('enc:' + input.trim()).toString('base64') + '\n', stderr: '' };
        if (/Unprotect/.test(script)) return { status: 0, stdout: Buffer.from(input.trim(), 'base64').toString().replace(/^enc:/, '') + '\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    };
    return { run, calls };
  };
  for (const [platform, kind] of [['darwin', 'keychain'], ['win32', 'dpapi'], ['linux', 'libsecret']]) {
    const f = fakeOs(platform);
    const store = makeSecretStore({ platform, run: f.run, env: {} });
    check(`${platform} store has kind ${kind} and is available`, store.kind === kind && store.available());
    const { blob } = store.set('alice@relay.test#abc123', TOKEN);
    check(`${platform} store round-trips a token`, store.get('alice@relay.test#abc123', blob) === TOKEN);
    check(`${platform} never passes the secret in argv`, f.calls.length > 0 && f.calls.every(c => !c.args.some(a => String(a).includes(TOKEN) || String(a).includes(blob || '\u0000'))), JSON.stringify(f.calls.map(c => c.args)));
    store.del('alice@relay.test#abc123');
    if (platform !== 'win32') check(`${platform} delete removes it`, store.get('alice@relay.test#abc123') === null);
  }
  {
    const f = fakeOs('darwin'); const store = makeSecretStore({ platform: 'darwin', run: f.run, env: {} });
    let refused = 0;
    for (const bad of ['short', 'has space in it padded 1234567890', 'x'.repeat(16) + '\nadd-generic-password -w pwned', 'a'.repeat(201)]) { try { store.set('acct', bad); } catch { refused++; } }
    try { store.set('acct"; rm -rf', TOKEN); } catch { refused++; }
    check('a malformed secret or account is refused before any command runs', refused === 5 && f.calls.length === 0);
  }
  {
    const store = makeSecretStore({ platform: 'linux', run: () => ({ status: null, stdout: '', stderr: '' }), env: {} });
    check('linux without secret-tool is not available (falls back to file)', store.available() === false);
    const headless = makeSecretStore({ platform: 'linux', run: (c, a) => (a[0] === '--version' ? { status: 0, stdout: '', stderr: '' } : { status: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' }), env: {} });
    check('linux with no D-Bus session is not available', headless.available() === false);
  }
  check('SLOPSTREAM_KEYCHAIN=off uses the file', makeSecretStore({ platform: 'darwin', run: () => { throw new Error('must not run'); }, env: { SLOPSTREAM_KEYCHAIN: 'off' } }).kind === 'file');
  check('two homes get different accounts', secretAccount({ user: 'a', relay: 'wss://r.test' }, '/h1') !== secretAccount({ user: 'a', relay: 'wss://r.test' }, '/h2'));
  check('account names use user, relay host and a home hash', /^a@r\.test#[0-9a-f]{12}$/.test(secretAccount({ user: 'a', relay: 'wss://r.test' }, '/h1')));

  // config.js with the fake keychain
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cfg-'));
  const f = fakeOs('darwin'); const store = makeSecretStore({ platform: 'darwin', run: f.run, env: {} });
  const cfg = { relay: 'wss://r.test', user: 'alice', token: TOKEN, auth: 'github', deviceId: 'd1' };
  check('saveConfig stores in the keychain', saveConfig(cfg, home, { store }) === 'keychain');
  const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  check('config.json has tokenStore and no token', onDisk.tokenStore === 'keychain' && !('token' in onDisk) && !JSON.stringify(onDisk).includes(TOKEN));
  check('loadConfig fills the token from the keychain', loadConfig(home, { store }).token === TOKEN);
  const lost = new Map(); const emptyStore = makeSecretStore({ platform: 'darwin', run: fakeOs('darwin').run, env: {} });
  const noTok = loadConfig(home, { store: emptyStore });
  check('a missing keychain item gives token null and tokenError', noTok.token === null && !!noTok.tokenError && noTok.user === 'alice');
  deleteSecret(onDisk, home, { store });
  check('deleteSecret removes the keychain item', loadConfig(home, { store }).token === null);

  // migration of an old plain-file config
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cfg-'));
  fs.writeFileSync(path.join(home2, 'config.json'), JSON.stringify(cfg));
  check('a plain token is NOT migrated unless asked (bridge path)', loadConfig(home2, { store }).token === TOKEN && !JSON.parse(fs.readFileSync(path.join(home2, 'config.json'), 'utf8')).tokenStore);
  check('a human command migrates the plain token into the keychain', loadConfig(home2, { store, migrate: true }).token === TOKEN && JSON.parse(fs.readFileSync(path.join(home2, 'config.json'), 'utf8')).tokenStore === 'keychain' && !fs.readFileSync(path.join(home2, 'config.json'), 'utf8').includes(TOKEN));
  // a store that cannot read back must not lose the token from the file
  const broken = { kind: 'keychain', available: () => true, set: () => ({}), get: () => null, del() {} };
  const home3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cfg-'));
  fs.writeFileSync(path.join(home3, 'config.json'), JSON.stringify(cfg));
  loadConfig(home3, { store: broken, migrate: true });
  check('migration keeps the file token when the read-back fails', JSON.parse(fs.readFileSync(path.join(home3, 'config.json'), 'utf8')).token === TOKEN);
  for (const h of [home, home2, home3]) fs.rmSync(h, { recursive: true, force: true });
}

// --- agent detection ---
{
  const runWith = (have) => (cmd) => (have[cmd] ? { status: 0, stdout: `${cmd} ${have[cmd]}\n`, stderr: '' } : { status: null, stdout: '', stderr: '', error: new Error('ENOENT') });
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ss-agents-'));
  const det = (have, files = [], dirs = []) => { const d = dir(); for (const f of files) fs.writeFileSync(path.join(d, f), ''); for (const x of dirs) fs.mkdirSync(path.join(d, x)); return detectAgents({ cwd: d, run: runWith(have) }); };
  const both = { claude: '2.1.90', codex: '0.5.0' };

  check('detect: reads installed versions', det(both).installed.claude.text === '2.1.90' && det({ claude: '2.1.90' }).installed.codex === null);
  check('detect hint: .codex/ means codex', det(both, [], ['.codex']).hint === 'codex');
  check('detect hint: .mcp.json means claude', det(both, ['.mcp.json']).hint === 'claude');
  check('detect hint: CLAUDE.md means claude', det(both, ['CLAUDE.md']).hint === 'claude');
  check('detect hint: both or neither means null', det(both, ['CLAUDE.md'], ['.codex']).hint === null && det(both).hint === null);

  const pick = (o) => chooseAgent({ isTTY: false, ask: async () => '', ...o });
  check('--agent always wins', (await pick({ flag: 'codex', detected: det({ claude: '2.1.90' }) })).agent === 'codex');
  check('exactly one installed: claude', (await pick({ detected: det({ claude: '2.1.90' }) })).agent === 'claude');
  check('exactly one installed: codex', (await pick({ detected: det({ codex: '0.5.0' }) })).agent === 'codex');
  check('both installed: the folder hint wins', (await pick({ detected: det(both, [], ['.codex']) })).agent === 'codex');
  let asked = 0;
  const tty = await pick({ detected: det(both), isTTY: true, ask: async () => { asked++; return '2'; } });
  check('both installed, no hint, TTY: asks, and takes the answer', asked === 1 && tty.agent === 'codex');
  check('both installed, no hint, TTY: Enter means Claude', (await pick({ detected: det(both), isTTY: true, ask: async () => '' })).agent === 'claude');
  asked = 0;
  const notty = await pick({ detected: det(both), isTTY: false, ask: async () => { asked++; return '2'; } });
  check('both installed, no hint, no TTY: claude without asking', asked === 0 && notty.agent === 'claude');
  const none = await pick({ detected: det({}) });
  check('none installed: claude plus a warning with the install link', none.agent === 'claude' && /Install one first/.test(none.warnings[0] || '') && /https:\/\//.test(none.warnings[0]));
  const old = await pick({ detected: det({ claude: '2.0.5' }) });
  check('old Claude Code: warns that channels need 2.1.80', old.agent === 'claude' && /2\.1\.80/.test(old.warnings.join()) && /claude update/.test(old.warnings.join()));
  check('new enough Claude Code: no warning', (await pick({ detected: det({ claude: '2.1.80' }) })).warnings.length === 0);
  check('the chosen agent is always announced with how to override', /Using Codex .*--agent claude/.test(describeChoice({ agent: 'codex', why: 'x' })));
}

// --- admin stats ---
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-stats-'));
  const kv = new FileKV(d); const day = new Date().toISOString().slice(0, 10);
  kv.put('stats:' + day, { msgs: 3, active: ['some-link-id'] });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../relay/admin.js', import.meta.url)), 'stats'], { env: { ...process.env, DATA_DIR: d }, encoding: 'utf8' });
  let rep = null; try { rep = JSON.parse(r.stdout); } catch { /* checked below */ }
  check('admin.js stats prints the report from the data dir (counts only)', rep?.wal === 1 && rep.days[0].msgs === 3 && !r.stdout.includes('some-link-id'), r.stdout + r.stderr);
  fs.rmSync(d, { recursive: true, force: true });
}

// --- chat settings ---
{
  const { loadChatSettings, saveChatSettings, DEFAULT_SETTINGS } = await import('../bridge/chat-settings.js');
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chatset-'));
  const d = loadChatSettings('web', h);
  check('chat settings: defaults when there is no file', d.guard === true && d.maxTurns === 4 && Object.keys(d.peers).length === 0);
  saveChatSettings('web', { guard: false, maxTurns: 7, peers: { bob: { mode: 'x' } } }, h);
  const m = loadChatSettings('web', h);
  check('chat settings: saved values are merged over the defaults', m.guard === false && m.maxTurns === 7 && m.peers.bob.mode === 'x' && m.v === 1);
  fs.writeFileSync(path.join(h, 'chats', 'web.json'), JSON.stringify({ guard: 'yes', maxTurns: -3, peers: [1] }));
  const bad = loadChatSettings('web', h);
  check('chat settings: invalid values fall back to defaults', bad.guard === true && bad.maxTurns === 4 && Object.keys(bad.peers).length === 0);
  fs.writeFileSync(path.join(h, 'chats', 'web.json'), '{not json');
  check('chat settings: a damaged file never throws', loadChatSettings('web', h).maxTurns === DEFAULT_SETTINGS.maxTurns);
  check('chat settings: a path-like chat label is refused', loadChatSettings('../evil', h).maxTurns === 4);
  fs.rmSync(h, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
