// Browser confirmation (T5): on a relay with GITHUB_CLIENT_SECRET set, a token alone cannot make a chat reachable.
// Runs against a spawned Node relay and a fake GitHub (device flow + browser sign-in). The browser is simulated with fetch.
process.env.SLOPSTREAM_KEYCHAIN = 'off';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startFakeGitHub } from './fake-github.js';
import { loadConfig } from '../bridge/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bridge/cli.js');
const TMP = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'ss-confirm-'));
// Set RELAY_URL (and GH_PORT to match the relay's GITHUB_BASE_URL) to run against an already-running relay, e.g. `wrangler dev`.
// That relay needs GITHUB_CLIENT_SECRET=test-secret and CONFIRM_TTL_MS=7000 (see relay/cloudflare/README.md).
const GH_PORT = Number(process.env.GH_PORT || 18796), PORT = 18797;
const RELAY = process.env.RELAY_URL || `ws://127.0.0.1:${PORT}`;
const HTTP = RELAY.replace(/^ws/, 'http');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function waitFor(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(50); } return null; }

const fake = await startFakeGitHub(GH_PORT);
const relay = process.env.RELAY_URL ? null : spawn('node', [path.join(ROOT, 'relay/server.js')], {
  env: { ...process.env, PORT, DATA_DIR: path.join(TMP, 'relay-data'), PUBLIC_URL: HTTP, GITHUB_CLIENT_ID: 'test', GITHUB_CLIENT_SECRET: 'test-secret',
    GITHUB_BASE_URL: fake.url, GITHUB_API_URL: fake.url, CONFIRM_TTL_MS: '7000' },
  stdio: ['ignore', 'pipe', 'inherit'] });
if (relay) await waitFor(() => new Promise(res => relay.stdout.once('data', () => res(true))));

const ACCOUNTS = { alice: { id: 1, login: 'Alice' }, bob: { id: 2, login: 'Bob' }, carol: { id: 3, login: 'Carol' }, mallory: { id: 99, login: 'Mallory' } };
const home = (n) => path.join(TMP, 'home-' + n);
const proj = (n) => { const d = path.join(TMP, 'proj' + n); fs.mkdirSync(d, { recursive: true }); return d; };
const env = (n) => ({ ...process.env, SLOPSTREAM_HOME: home(n), SLOPSTREAM_RELAY: RELAY, SLOPSTREAM_NO_BROWSER: '1', SLOPSTREAM_ALLOW_NONINTERACTIVE: '1' });
function start(n, cwd, ...a) {
  const p = spawn('node', [CLI, ...a], { cwd, env: env(n), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  return { p, out: () => out, exit: new Promise(res => p.on('exit', c => res(c))) };
}
const run = (n, cwd, ...a) => { const r = spawnSync('node', [CLI, ...a], { cwd, env: env(n), encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
async function login(n) {
  const c = start(n, TMP, 'login', '--relay', RELAY);
  const uc = (await waitFor(() => c.out().match(/UC\d+-TEST/)))?.[0];
  if (uc) fake.authorize(uc, ACCOUNTS[n]);
  return { code: await c.exit, out: c.out() };
}

// ---- the simulated browser ----
// Follows redirects by hand, keeps the cookie, and returns the final response.
async function browse(url, account, { cookie = '' } = {}) {
  fake.setBrowserUser(account);
  let u = url; const hops = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    hops.push({ status: r.status, url: u, location: r.headers.get('location'), setCookie: sc });
    if (r.status >= 300 && r.status < 400) { u = new URL(r.headers.get('location'), u).toString(); continue; }
    const text = await r.text();
    return { status: r.status, text, headers: r.headers, cookie, hops, csrf: /name="csrf" value="([^"]+)"/.exec(text)?.[1] };
  }
  throw new Error('too many redirects');
}
const post = (url, cookie, fields) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(fields).toString() });
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// Opens the confirm page as `account` and presses a button.
async function browserConfirm(url, account, decision) {
  const b = await browse(url, account);
  const r = await post(url, b.cookie, { csrf: b.csrf, decision });
  return { page: b, status: r.status, text: await r.text() };
}

// ---- a raw protocol client: what a tricked agent with a shell would use ----
function raw(n, { v = 3 } = {}) {
  const cfg = loadConfig(home(n));
  const msgs = [];
  const ws = new WebSocket(RELAY);
  ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  const opened = new Promise(res => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', v, user: n, token: cfg.token })); res(); }));
  return {
    msgs, ws,
    ready: async () => { await opened; await waitFor(() => msgs.find(m => m.t === 'welcome' || m.t === 'error')); return msgs.find(m => m.t === 'welcome'); },
    send: (o) => ws.send(JSON.stringify(o)),
    wait: (t, f = () => true, ms = 5000) => waitFor(() => msgs.find(m => m.t === t && f(m)), ms),
    has: (t) => msgs.some(m => m.t === t),
    close: () => ws.close(),
  };
}
const linksOf = async (n) => { const c = raw(n); await c.ready(); c.send({ t: 'list_links' }); const m = await c.wait('links'); c.close(); return m.links; };

// ---- logins ----
for (const n of ['alice', 'bob', 'carol']) check(`${n} logs in`, (await login(n)).code === 0);
const info = await (await fetch(`${HTTP}/v1/info`)).json();
check('/v1/info reports confirmLinks true and protocol 4', info.confirmLinks === true && info.protocol === 4, JSON.stringify(info));

// ---- 1-2. the real CLI flow: link + join, one browser click each ----
const pA = proj('A'), pB = proj('B');
const linkA = start('alice', pA, 'link', 'web');
const url = (await waitFor(() => linkA.out().match(/https?:\/\/\S+\/j\/[a-z2-9]{5}-[a-z2-9]{5}/)))?.[0];
const joinB = start('bob', pB, 'join', url, 'api');
const bobUrl = (await waitFor(() => joinB.out().match(/Approve in your browser: (\S+)/)))?.[1];
check('join prints a browser link', !!bobUrl && /\/c\//.test(bobUrl), joinB.out());
check('join links nothing until approved in the browser', (await linksOf('alice')).length === 0 && !/Linked!/.test(joinB.out()));
check('join did not ask for a terminal y/N', !/\[y\/N\]/.test(joinB.out()));

const bobPage = await browse(bobUrl, ACCOUNTS.bob);
check('accept page names the other person and both chats', bobPage.status === 200 && /@alice/.test(bobPage.text) && /'api'/.test(decode(bobPage.text)) && /'web'/.test(decode(bobPage.text)) && /github\.com\/Alice/.test(bobPage.text), bobPage.text.slice(0, 400));
check('confirm page tells people to deny if they did not just run the command', /click Deny/.test(bobPage.text));
check("confirm page sends frame-ancestors 'none' and x-frame-options DENY", /frame-ancestors 'none'/.test(bobPage.headers.get('content-security-policy') || '') && bobPage.headers.get('x-frame-options') === 'DENY');
const ok1 = await post(bobUrl, bobPage.cookie, { csrf: bobPage.csrf, decision: 'approve' });
check('bob approves in the browser', ok1.status === 200 && /Done/.test(await ok1.text()));
check('confirm id is single use (second POST -> 404)', (await post(bobUrl, bobPage.cookie, { csrf: bobPage.csrf, decision: 'approve' })).status === 404);

const aliceUrl = (await waitFor(() => linkA.out().match(/Approve in your browser: (\S+)/)))?.[1];
check('link side then prints its own browser link', !!aliceUrl && aliceUrl !== bobUrl, linkA.out());
const alicePage = await browse(aliceUrl, ACCOUNTS.alice);
check('approve page names the requester', /@bob|github\.com\/Bob/.test(alicePage.text) && /wants to link their chat/.test(decode(alicePage.text)), alicePage.text.slice(0, 300));
await post(aliceUrl, alicePage.cookie, { csrf: alicePage.csrf, decision: 'approve' });
const [ca, cb] = await Promise.all([linkA.exit, joinB.exit]);
check('link side approves in the browser and both print Linked!', ca === 0 && cb === 0 && /Linked!/.test(linkA.out()) && /Linked!/.test(joinB.out()), linkA.out() + joinB.out());
check('exactly one link now exists', (await linksOf('alice')).length === 1);

// ---- 3-4. a tricked agent with a stolen token ----
const attackerInvite = raw('alice'); await attackerInvite.ready();
attackerInvite.send({ t: 'pair_create', chat: 'steal1' });
const inv1 = await attackerInvite.wait('pair_code');
const stolen = raw('carol'); await stolen.ready();
stolen.send({ t: 'pair_accept', code: inv1.code, chat: 'sneaky' });
const cr = await stolen.wait('confirm_required');
check('stolen token over the raw protocol: pair_accept gets confirm_required, not pair_waiting', !!cr && !stolen.has('pair_waiting') && cr.action === 'accept', JSON.stringify(stolen.msgs));
await sleep(200);
check('...and the inviter sees no request', !attackerInvite.has('pair_request'));
check('...and the invite has no requester', (await (await fetch(`${HTTP}/v1/invite/${inv1.code}`)).json()).status === 'open');

// carol's human confirms for real, so alice's side has a request to decide on
const cOk = await browserConfirm(cr.url, ACCOUNTS.carol, 'approve');
check('carol approves in her browser', cOk.status === 200);
const pr = await attackerInvite.wait('pair_request');
check('now the inviter sees the request', !!pr && pr.from.user === 'carol');
attackerInvite.send({ t: 'pair_decision', code: pr.code, ok: true });
const cr2 = await attackerInvite.wait('confirm_required');
check('stolen token: pair_decision ok gets confirm_required', !!cr2 && cr2.action === 'approve' && !attackerInvite.has('paired'));
await sleep(200);
check('...and no link exists until the browser approves', !(await linksOf('alice')).some(l => l.members.some(m => m.user === 'carol')));
await browserConfirm(cr2.url, ACCOUNTS.alice, 'approve');
check('...then the link exists', !!(await attackerInvite.wait('paired')) && (await linksOf('alice')).some(l => l.members.some(m => m.user === 'carol')));
attackerInvite.close(); stolen.close();

// ---- 5-8. web session checks ----
const a2 = raw('alice'); await a2.ready();
a2.send({ t: 'pair_create', chat: 'sess1' }); const invS1 = await a2.wait('pair_code');
a2.send({ t: 'pair_create', chat: 'sess2' }); const invS2 = await a2.wait('pair_code', (m) => m.code !== invS1.code);
const c2 = raw('carol'); await c2.ready();
c2.send({ t: 'pair_accept', code: invS1.code, chat: 'cs1' }); const k1 = await c2.wait('confirm_required');
c2.send({ t: 'pair_accept', code: invS2.code, chat: 'cs2' }); const k2 = await c2.wait('confirm_required', (m) => m.id !== k1.id);

const noSess = await fetch(k1.url, { redirect: 'manual' });
const loc = noSess.headers.get('location') || '';
check('confirm page without a GitHub session redirects to GitHub authorize', noSess.status === 302 && loc.startsWith(`${fake.url}/login/oauth/authorize?`) && /client_id=test/.test(loc) && /allow_signup=false/.test(loc), loc);

fake.setBrowserUser(ACCOUNTS.mallory);
const wrong = await browse(k1.url, ACCOUNTS.mallory);
check('callback signed in as a different GitHub account -> 403 and no cookie', wrong.status === 403 && /Wrong GitHub account/.test(wrong.text) && !wrong.hops.some(h => h.setCookie) && /@Mallory/.test(wrong.text), JSON.stringify(wrong.hops));
check('...and nothing changed (confirm still there)', (await fetch(k1.url, { redirect: 'manual' })).status === 302);

const good1 = await browse(k1.url, ACCOUNTS.carol);
check('session cookie is HttpOnly and SameSite=Lax', /HttpOnly/i.test(good1.hops.find(h => h.setCookie)?.setCookie || '') && /SameSite=Lax/i.test(good1.hops.find(h => h.setCookie)?.setCookie || ''));
const noCsrf = await post(k1.url, good1.cookie, { decision: 'approve' });
check('POST without csrf -> 403, confirm still pending', noCsrf.status === 403 && (await fetch(k1.url, { redirect: 'manual', headers: { cookie: good1.cookie } })).status === 200);
const good2 = await browse(k2.url, ACCOUNTS.carol, { cookie: good1.cookie });
const crossCsrf = await post(k1.url, good1.cookie, { csrf: good2.csrf, decision: 'approve' });
check("POST with another confirm's csrf -> 403", crossCsrf.status === 403);
const noCookie = await post(k1.url, '', { csrf: good1.csrf, decision: 'approve' });
check('POST without the session cookie -> 403', noCookie.status === 403);
const forgedCookie = await post(k1.url, 'ss_web=' + Buffer.from(JSON.stringify({ u: 'carol', gh: 3, exp: Date.now() + 1e6 })).toString('base64url') + '.AAAA', { csrf: good1.csrf, decision: 'approve' });
check('a cookie with a bad HMAC is rejected', forgedCookie.status === 403);

// ---- 11-12. deny in the browser ----
const dn = await post(k2.url, good2.cookie, { csrf: good2.csrf, decision: 'deny' });
check('deny in the browser on accept -> confirm_declined', dn.status === 200 && !!(await c2.wait('confirm_declined')));
check('...and the invite is still open', (await (await fetch(`${HTTP}/v1/invite/${invS2.code}`)).json()).status === 'open');

const accOk = await post(k1.url, good1.cookie, { csrf: good1.csrf, decision: 'approve' });
await a2.wait('pair_request', (m) => m.from.chat === 'cs1');
check('(carol approves her accept)', accOk.status === 200);
a2.send({ t: 'pair_decision', code: invS1.code, ok: true });
const k3 = await a2.wait('confirm_required');
const denied = await browserConfirm(k3.url, ACCOUNTS.alice, 'deny');
check('deny in the browser on approve -> both sides get pair_denied', denied.status === 200 && !!(await a2.wait('pair_denied')) && !!(await c2.wait('pair_denied')));
a2.close(); c2.close();

// ---- 14. an old client ----
const old = raw('bob', { v: 2 }); await old.ready();
const a3 = raw('alice'); await a3.ready(); a3.send({ t: 'pair_create', chat: 'old1' }); const invO = await a3.wait('pair_code');
old.send({ t: 'pair_accept', code: invO.code, chat: 'oldchat' });
const up = await old.wait('error');
check('v2 hello + pair_accept on a confirm relay -> upgrade_required', up?.code === 'upgrade_required' && !old.has('pair_waiting') && !old.has('confirm_required'), JSON.stringify(old.msgs));
old.close(); a3.close();

// ---- 13. nobody clicks ----
const a4 = raw('alice'); await a4.ready(); a4.send({ t: 'pair_create', chat: 'exp1' }); const invE = await a4.wait('pair_code');
const pE = proj('E');
const joinE = start('bob', pE, 'join', invE.url, 'expchat');
const expUrl = await waitFor(() => joinE.out().match(/Approve in your browser: (\S+)/));
const exited = await Promise.race([joinE.exit, sleep(process.env.RELAY_URL ? 60000 : 20000).then(() => 'timeout')]);
check('unconfirmed request expires -> CLI exits 1 with "Nothing was linked"', !!expUrl && exited === 1 && /Nothing was linked/.test(joinE.out()) && /→/.test(joinE.out()), `${exited} ${joinE.out()}`);
check('...and the expired link is gone', (await fetch(expUrl[1], { redirect: 'manual' })).status === 404);
a4.close();

fake.close(); relay?.kill();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
