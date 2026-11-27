// `slopstream doctor`: one check per step, with the fix for each failure. Runs against a spawned Node relay (legacy users).
process.env.SLOPSTREAM_KEYCHAIN = 'off';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveConfig } from '../bridge/config.js';
import { pairBoth } from '../bridge/net.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bridge/cli.js');
const ADMIN = path.join(ROOT, 'relay/admin.js');
const TMP = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'ss-doctor-'));
const PORT = 18799, RELAY = `ws://127.0.0.1:${PORT}`;
const DATA = path.join(TMP, 'relay-data');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

const relay = spawn('node', [path.join(ROOT, 'relay/server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(res => relay.stdout.once('data', res));
const addUser = (n) => spawnSync('node', [ADMIN, 'add-user', n], { env: { ...process.env, DATA_DIR: DATA }, encoding: 'utf8' }).stdout.match(/token: (\S+)/)[1];

const dir = (n) => { const d = path.join(TMP, n); fs.mkdirSync(d, { recursive: true }); return d; };
const homeA = dir('homeA'), homeB = dir('homeB'), folder = dir('folder');
const cfgA = { relay: RELAY, user: 'doc-a', token: addUser('doc-a') }, cfgB = { relay: RELAY, user: 'doc-b', token: addUser('doc-b') };
saveConfig(cfgA, homeA); saveConfig(cfgB, homeB);
await pairBoth(cfgA, 'doc', cfgB, 'doc');

// The doctor asks for the Claude Code version; `node --version` prints one that is new enough, on every OS.
const env = (home, extra = {}) => ({ ...process.env, SLOPSTREAM_HOME: home, SLOPSTREAM_NO_UPDATE_CHECK: '1', SLOPSTREAM_CLAUDE_BIN: process.execPath, ...extra });
const cli = (cwd, home, ...a) => { const r = spawnSync('node', [CLI, ...a], { cwd, env: env(home), encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' }; };
const find = (checks, id) => checks.find(c => c.id === id);

cli(folder, homeA, 'init', 'doc', '--agent', 'claude');

// healthy
const ok = cli(folder, homeA, 'doctor');
check('healthy wired folder: all checks pass, exit 0', ok.code === 0 && !/✗/.test(ok.out) && /All good/.test(ok.out), ok.out);
const js = cli(folder, homeA, 'doctor', '--json');
let arr = null; try { arr = JSON.parse(js.stdout); } catch { /* checked below */ }
const IDS = ['node', 'version', 'login', 'token', 'relay', 'protocol', 'auth', 'folder', 'rules', 'chat', 'paused', 'linked', 'peers', 'session', 'claude', 'codex'];
check('--json is valid JSON with an id per check', Array.isArray(arr) && IDS.every(id => find(arr, id)) && arr.every(c => 'id' in c && 'ok' in c && c.msg), js.stdout.slice(0, 200));
check('linked check names the peer', /doc-b\/doc/.test(find(arr, 'linked')?.msg || ''));
check('peers and session are informational (null), not failures', find(arr, 'peers')?.ok === null && find(arr, 'session')?.ok === null && /Start it with/.test(find(arr, 'session').msg));
check('token check says which store', /plain file/.test(find(arr, 'token')?.msg || ''));

// no login
const nologin = cli(folder, dir('emptyhome'), 'doctor');
check('no login: login ✗ with fix, exit 1', nologin.code === 1 && /✗ not logged in/.test(nologin.out) && /→ slopstream login/.test(nologin.out), nologin.out);

// folder not wired
const bare = cli(dir('bare'), homeA, 'doctor', '--chat', 'doc');
check('folder not wired: folder ✗ suggests init', bare.code === 1 && /✗ this folder is not set up/.test(bare.out) && /→ slopstream init doc/.test(bare.out), bare.out);

// paused
cli(folder, homeA, 'pause', 'doc');
const paused = cli(folder, homeA, 'doctor');
check('paused chat: paused ✗ suggests resume', paused.code === 1 && /✗ chat "doc" is paused/.test(paused.out) && /→ slopstream resume doc/.test(paused.out), paused.out);
cli(folder, homeA, 'resume', 'doc');

// not linked
const other = dir('otherfolder'); cli(other, homeA, 'init', 'lonely', '--agent', 'claude');
const unlinked = cli(other, homeA, 'doctor');
check('chat that is not linked: linked ✗ suggests link', unlinked.code === 1 && /✗ chat "lonely" is not linked/.test(unlinked.out) && /→ slopstream link/.test(unlinked.out), unlinked.out);

// relay down
const homeDown = dir('homeDown'); saveConfig({ relay: 'ws://127.0.0.1:1', user: 'doc-a', token: cfgA.token }, homeDown);
const down = cli(folder, homeDown, 'doctor');
check('relay down: relay ✗, no crash', down.code === 1 && /✗ cannot reach the relay/.test(down.out) && !/TypeError|at .*\.js:\d+/.test(down.out), down.out);

// wrong token
const homeBad = dir('homeBad'); saveConfig({ relay: RELAY, user: 'doc-a', token: 'wrong-token-wrong-token-1234' }, homeBad);
const bad = cli(folder, homeBad, 'doctor');
check('bad token: auth ✗ suggests login', bad.code === 1 && /✗ the relay did not accept your login/.test(bad.out) && /→ slopstream login/.test(bad.out), bad.out);

// status points at doctor
check('status ends with a pointer to doctor', /Something wrong\? Run: slopstream doctor/.test(cli(folder, homeA, 'status').out));

relay.kill();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
