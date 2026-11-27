// End-to-end: GitHub login (fake GitHub), `link` + `join`, later approval, devices, logout, join page, human-only guard.
process.env.SLOPSTREAM_KEYCHAIN = 'off'; // tests must never touch the real keychain (children inherit this)
// Set RELAY_URL (e.g. ws://127.0.0.1:18800) to run against an already-running relay instead of spawning the Node one.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFakeGitHub } from './fake-github.js';
import { loadConfig } from '../bridge/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bridge/cli.js');
const TMP = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'ss-login-'));
const GH_PORT = 18795, PORT = 18793;
const RELAY = process.env.RELAY_URL || `ws://127.0.0.1:${PORT}`;
const HTTP = RELAY.replace(/^ws/, 'http');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function waitFor(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(50); } return null; }

const fake = await startFakeGitHub(GH_PORT);
let relay = null;
if (!process.env.RELAY_URL) {
  relay = spawn('node', [path.join(ROOT, 'relay/server.js')], {
    env: { ...process.env, PORT, DATA_DIR: path.join(TMP, 'relay-data'), PUBLIC_URL: HTTP, GITHUB_CLIENT_ID: 'test', GITHUB_BASE_URL: fake.url, GITHUB_API_URL: fake.url },
    stdio: ['ignore', 'pipe', 'inherit'] });
  await waitFor(() => new Promise(res => relay.stdout.once('data', () => res(true))));
}

const home = (n) => path.join(TMP, 'home-' + n);
const proj = (n) => { const d = path.join(TMP, 'proj' + n); fs.mkdirSync(d, { recursive: true }); return d; };
const env = (n, extra = {}) => ({ ...process.env, SLOPSTREAM_HOME: home(n), SLOPSTREAM_RELAY: RELAY, SLOPSTREAM_NO_BROWSER: '1', SLOPSTREAM_ALLOW_NONINTERACTIVE: '1', ...extra });
function start(n, cwd, ...a) {
  const p = spawn('node', [CLI, ...a], { cwd, env: env(n), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const exit = new Promise(res => p.on('exit', c => res(c)));
  return { p, out: () => out, exit };
}
const run = (n, cwd, ...a) => { const r = spawnSync('node', [CLI, ...a], { cwd, env: env(n), encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

async function login(n, id, login) {
  const c = start(n, TMP, 'login', '--relay', RELAY);
  const uc = (await waitFor(() => c.out().match(/UC\d+-TEST/)))?.[0];
  if (uc) fake.authorize(uc, { id, login });
  const code = await c.exit;
  return { code, out: c.out() };
}

// 1-2. logins
const la = await login('alice', 1, 'Alice');
check('alice logs in via GitHub device flow', la.code === 0 && /Logged in as alice/.test(la.out), la.out);
const cfgA = loadConfig(home('alice'));
check('config has auth:github and an sst_ token', cfgA.auth === 'github' && cfgA.token.startsWith('sst_'));
check('config keeps working with tokenStore file', JSON.parse(fs.readFileSync(path.join(home('alice'), 'config.json'), 'utf8')).tokenStore === 'file');
const lb = await login('bob', 2, 'Bob'); const lc = await login('carol', 3, 'Carol');
check('bob and carol log in', /Logged in as bob/.test(lb.out) && /Logged in as carol/.test(lc.out));
check('whoami shows alice', /alice/.test(run('alice', TMP, 'whoami').out));

// 4-7. link + join
const pA = proj('A'), pB = proj('B'), pC = proj('C'), pD = proj('D');
const linkA = start('alice', pA, 'link', 'web', '--yes');
const url = (await waitFor(() => linkA.out().match(/https?:\/\/\S+\/j\/[a-z2-9]{5}-[a-z2-9]{5}/)))?.[0];
check('link prints a join url', !!url, linkA.out());
const code = url?.split('/j/')[1];
const page = await fetch(url);
const pageText = await page.text();
check('join page: 200, names inviter, shows the command', page.status === 200 && pageText.includes('@alice') && pageText.includes('slopstream join'));
check('join page sends the hardening headers', /default-src 'none'/.test(page.headers.get('content-security-policy') || '') && page.headers.get('x-content-type-options') === 'nosniff');
check('GET /v1/invite/<code> is open', (await (await fetch(`${HTTP}/v1/invite/${code}`)).json()).status === 'open');
const joinB = start('bob', pB, 'join', url, 'api', '--yes');
const [ca, cb] = await Promise.all([linkA.exit, joinB.exit]);
check('both sides print Linked!', ca === 0 && cb === 0 && /Linked!/.test(linkA.out()) && /Linked!/.test(joinB.out()), linkA.out() + joinB.out());
const mcp = (d) => JSON.parse(fs.readFileSync(path.join(d, '.mcp.json'), 'utf8')).mcpServers.slopstream.env.SLOPSTREAM_CHAT;
check('both folders wired up', mcp(pA) === 'web' && mcp(pB) === 'api');

// 8. messages through bridges
async function startBridge(n, chat) {
  const inbox = [];
  const client = new Client({ name: 'test-' + n, version: '0' }, { capabilities: {} });
  client.fallbackNotificationHandler = async (m) => { if (m.method === 'notifications/claude/channel') inbox.push(m.params); };
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(ROOT, 'bridge/server.js')], env: { ...env(n), SLOPSTREAM_CHAT: chat }, stderr: 'ignore' }));
  const call = async (name, a = {}) => { const r = await client.callTool({ name, arguments: a }); return { err: !!r.isError, text: r.content[0].text }; };
  return { client, inbox, call };
}
const BA = await startBridge('alice', 'web'); const BB = await startBridge('bob', 'api');
await waitFor(async () => JSON.parse((await BA.call('link_status')).text).peerOnline);
const sent = await BA.call('send_message', { text: 'hello from alice' });
const got = await waitFor(() => BB.inbox[0]);
check('alice -> bob delivered over a device-token login', !sent.err && got?.meta?.from === 'alice', sent.text);
await BA.client.close(); await BB.client.close();

// 9. later approval
const linkLater = start('bob', pC, 'link', 'later', '--yes');
const url2 = (await waitFor(() => linkLater.out().match(/https?:\/\/\S+\/j\/[a-z2-9]{5}-[a-z2-9]{5}/)))?.[0];
linkLater.p.kill('SIGKILL'); // closes the terminal
const code2 = url2?.split('/j/')[1];
const joinC = start('carol', pD, 'join', url2, 'carolchat', '--yes');
await waitFor(() => /Waiting for @bob/.test(joinC.out()));
const rq = await waitFor(() => { const r = run('bob', pC, 'requests'); return /carol/.test(r.out) ? r : null; }, 8000);
check('requests lists carol\'s request (invite outlived the terminal)', !!rq, rq?.out);
const ap = run('bob', pC, 'approve', code2, '--yes');
check('approve links them', /Linked/.test(ap.out), ap.out);
check('carol\'s waiting join prints Linked!', (await joinC.exit) === 0 && /Linked!/.test(joinC.out()), joinC.out());

// 10. used link
const again = run('carol', pD, 'join', url2, 'x', '--yes');
check('reusing a used link fails with a clear message', again.code === 1 && /expired|used|unknown/i.test(again.out) && again.out.includes('→'), again.out);
check('GET /j/<code> of a used invite is 404', (await fetch(url2)).status === 404);

// 10b. directed invite: link @bob
const linkDir = start('alice', proj('F'), 'link', '@bob', 'dirchat', '--yes');
const urlDir = (await waitFor(() => linkDir.out().match(/https?:\/\/\S+\/j\/[a-z2-9]{5}-[a-z2-9]{5}/)))?.[0];
check('link @bob prints a url and says only bob can use it', !!urlDir && /only @bob can use it/.test(linkDir.out()) && /slopstream requests/.test(linkDir.out()), linkDir.out());
check('the join page says it is for bob', /This invite is for @bob/.test(await (await fetch(urlDir)).text()));
const rqBob = run('bob', TMP, 'requests');
check('bob sees it under "Invites for you"', /Invites for you/.test(rqBob.out) && rqBob.out.includes(urlDir.split('/j/')[1]) && /→ slopstream join/.test(rqBob.out), rqBob.out);
const joinCarolDir = run('carol', proj('G'), 'join', urlDir, 'x', '--yes');
check('carol cannot join an invite made for bob', joinCarolDir.code === 1 && /someone else/.test(joinCarolDir.out) && /→/.test(joinCarolDir.out), joinCarolDir.out);
const joinBobDir = start('bob', proj('H'), 'join', urlDir, 'dirjoin', '--yes');
const [cd1, cd2] = await Promise.all([linkDir.exit, joinBobDir.exit]);
check('bob joins with it and both print Linked!', cd1 === 0 && cd2 === 0 && /Linked!/.test(joinBobDir.out()), linkDir.out() + joinBobDir.out());

// 11. human-only guard
const guard = spawnSync('node', [CLI, 'join', 'aaaaa-bbbbb'], { cwd: pD, env: { ...env('carol'), SLOPSTREAM_ALLOW_NONINTERACTIVE: '' }, encoding: 'utf8' });
check('join without a TTY is refused', guard.status === 1 && /must be typed by a person/.test(guard.stderr), guard.stderr);

// 12. devices + logout
const dv = run('alice', TMP, 'devices');
check('devices shows this device', /\(this device\)/.test(dv.out), dv.out);
const lo = run('alice', TMP, 'logout');
check('logout works and whoami then fails', /Logged out/.test(lo.out) && run('alice', TMP, 'whoami').code === 1);
const oldTok = await new Promise((res) => {
  const ws = new WebSocket(RELAY);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', user: 'alice', token: cfgA.token })));
  ws.on('message', d => { res(JSON.parse(d.toString())); ws.close(); });
});
check('old device token is dead after logout', oldTok.t === 'error' && oldTok.code === 'auth', JSON.stringify(oldTok));

// 13. denied login
const d = start('dave', TMP, 'login', '--relay', RELAY);
const duc = (await waitFor(() => d.out().match(/UC\d+-TEST/)))?.[0]; fake.deny(duc);
check('denied login exits 1 and says denied', (await d.exit) === 1 && /denied/i.test(d.out()), d.out());

fake.close(); relay?.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
