// Unit tests for RelayCore: no network, no files. Run: node test/core.js
process.env.SLOPSTREAM_KEYCHAIN = 'off'; // tests must never touch the real keychain (children inherit this)
import crypto from 'node:crypto';
import { RelayCore, configFromEnv, statsReport } from '../relay/core.js';
import { MemKV } from '../relay/kv-mem.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name, extra); } };

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
class FakeConn {
  constructor() { this.meta = {}; this.sent = []; this.closed = null; }
  saveMeta() {}
  send(o) { this.sent.push(o); }
  close(c, r) { this.closed = { c, r }; }
  lastActivity() { return Date.now(); }
}
const last = (conn, type) => [...conn.sent].reverse().find(m => m.t === type);

let clock = 1_000_000;
const kv = new MemKV({ users: { alice: sha('ta'), bob: sha('tb') } });
const core = new RelayCore({ kv, config: configFromEnv({}), now: () => clock });
const open = () => { const c = new FakeConn(); core.openConn(c); return c; };
const say = (c, o) => core.onMessage(c, JSON.stringify(o));
const hello = (user, token, chat) => { const c = open(); say(c, { t: 'hello', user, token, ...(chat ? { chat } : {}) }); return c; };

const bad = hello('alice', 'nope');
check('bad token -> error auth', last(bad, 'error')?.code === 'auth');
check('bad token -> close 4003', bad.closed?.c === 4003);

const pre = open(); say(pre, { t: 'ping' });
check('ping before hello -> pong', !!last(pre, 'pong'));

const a = hello('alice', 'ta');
check('admin hello -> welcome admin', last(a, 'welcome')?.mode === 'admin');
const b = hello('bob', 'tb');

say(a, { t: 'pair_create', chat: 'web' });
const code = last(a, 'pair_code')?.code;
say(b, { t: 'pair_accept', code, chat: 'api' });
check('requester gets pair_waiting', !!last(b, 'pair_waiting'));
check('inviter gets pair_request', last(a, 'pair_request')?.from.user === 'bob');
say(a, { t: 'pair_decision', code, ok: true });
check('paired on both sides', !!last(a, 'paired') && !!last(b, 'paired'));
check('one link stored', kv.get('links').length === 1);

const sa = hello('alice', 'ta', 'web');
check('session hello -> welcome session', last(sa, 'welcome')?.mode === 'session');
const sb = hello('bob', 'tb', 'api');
say(sa, { t: 'msg', id: 'm1', parts: [{ kind: 'text', text: 'hi' }] });
check('message delivered to peer', last(sb, 'msg')?.parts[0].text === 'hi');
check('sender gets ack delivered', last(sa, 'ack')?.delivered === true);

const stale = open();
clock += 11_000;
core.sweep();
check('sweep closes unauthenticated conn older than 10s', stale.closed?.c === 4001);

const res = await core.handleHttp({ method: 'GET', path: '/healthz', body: '', ip: '' });
check('GET /healthz -> 200', res.status === 200 && JSON.parse(res.body).ok === true);


// ---- T2: persistent invites ----
const newKv = () => new MemKV({ users: { alice: sha('ta'), bob: sha('tb'), carol: sha('tc') } });
function world(env = {}, kv2 = newKv()) {
  const c2 = new RelayCore({ kv: kv2, config: configFromEnv(env), now: () => clock });
  const op = () => { const c = new FakeConn(); c2.openConn(c); return c; };
  const hi = (u, t) => { const c = op(); c2.onMessage(c, JSON.stringify({ t: 'hello', user: u, token: t })); return c; };
  const sy = (c, o) => c2.onMessage(c, JSON.stringify(o));
  return { core: c2, kv: kv2, hi, sy, op };
}
{
  const w = world();
  const a1 = w.hi('alice', 'ta'); const b1 = w.hi('bob', 'tb');
  w.sy(a1, { t: 'pair_create', chat: 'web' });
  const pc = last(a1, 'pair_code');
  check('pair_code has dashed code, url and 24h expiry', /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(pc.code) && pc.url.endsWith('/j/' + pc.code) && pc.expiresInSec === 86400);
  w.core.onClose(a1); // creator closes the terminal
  check('invite survives the creator closing', !!w.kv.get('invite:' + pc.code.replace('-', '')));
  w.sy(b1, { t: 'pair_accept', code: pc.code.toUpperCase(), chat: 'api' });
  check('upper-case code with dash is accepted (normalization)', !!last(b1, 'pair_waiting'));
  const a2 = w.hi('alice', 'ta');
  check('new admin conn receives nothing automatically', !last(a2, 'pair_request'));
  w.sy(a2, { t: 'list_requests' });
  const lr = last(a2, 'requests').invites[0];
  check('list_requests shows the request', lr.requester?.user === 'bob' && lr.requester.github === null && lr.code === pc.code);
  w.sy(a2, { t: 'pair_decision', code: pc.code, ok: true });
  check('decision from a different conn links both', !!last(a2, 'paired') && !!last(b1, 'paired') && w.kv.get('links').length === 1);
  check('invite consumed after approval', !w.kv.get('invite:' + pc.code.replace('-', '')));
}
{
  const w = world();
  const a = w.hi('alice', 'ta'); const b = w.hi('bob', 'tb');
  w.sy(a, { t: 'pair_create', chat: 'web' }); const code = last(a, 'pair_code').code;
  w.sy(b, { t: 'pair_accept', code, chat: 'api' });
  w.sy(a, { t: 'pair_decision', code, ok: false });
  check('deny notifies both sides', !!last(a, 'pair_denied') && !!last(b, 'pair_denied'));
  w.sy(b, { t: 'pair_accept', code, chat: 'api' });
  check('deny consumes the invite', last(b, 'error')?.code === 'bad_code');
  w.sy(b, { t: 'invite_cancel', code }); // not even real any more
  w.sy(a, { t: 'pair_create', chat: 'web' }); const c2 = last(a, 'pair_code').code;
  w.sy(b, { t: 'invite_cancel', code: c2 });
  check('invite_cancel by a non-owner -> bad_code', last(b, 'error')?.code === 'bad_code');
  w.sy(a, { t: 'invite_cancel', code: c2 });
  check('invite_cancel by the owner works', last(a, 'invite_cancelled')?.code === c2 && !w.kv.get('invite:' + c2.replace('-', '')));
}
{
  const w = world();
  const a = w.hi('alice', 'ta');
  w.sy(a, { t: 'pair_create', chat: 'web' }); const code = last(a, 'pair_code').code;
  clock += 86_400_001;
  const b = w.hi('bob', 'tb');
  w.sy(b, { t: 'pair_accept', code, chat: 'api' });
  check('expired invite -> bad_code', last(b, 'error')?.code === 'bad_code');
  w.sy(a, { t: 'pair_create', chat: 'web' }); const c2 = last(a, 'pair_code').code;
  clock += 86_400_001;
  w.core.sweep();
  check('sweep deletes expired invites', w.kv.list('invite:').length === 0);
}
{
  const w = world();
  const b = w.hi('bob', 'tb');
  for (let i = 0; i < 10; i++) w.sy(b, { t: 'pair_accept', code: 'aaaaa-aaaaa', chat: 'api' });
  w.sy(b, { t: 'pair_accept', code: 'aaaaa-aaaaa', chat: 'api' });
  check('10 bad codes -> too_many_attempts', last(b, 'error')?.code === 'too_many_attempts');
}
{
  const w = world({ MAX_OPEN_INVITES: '2' });
  const a = w.hi('alice', 'ta');
  for (let i = 0; i < 3; i++) w.sy(a, { t: 'pair_create', chat: 'c' + i });
  check('MAX_OPEN_INVITES enforced', last(a, 'error')?.code === 'too_many_invites' && w.kv.list('invite:').length === 2);
}

// ---- T3: device tokens + GitHub device flow (fake fetch, no network) ----
{
  // Scripted GitHub: `ghState` decides what the access_token endpoint answers.
  let ghState = 'pending'; let calls = 0; let ghInterval = null; const ghUser = { id: 11, login: 'Dana' };
  const fakeFetch = async (url, init = {}) => {
    calls++;
    const ok = (o) => ({ ok: true, status: 200, json: async () => o });
    if (url.endsWith('/login/device/code')) return ok({ device_code: 'dc', user_code: 'UC-1', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    if (url.endsWith('/login/oauth/access_token')) {
      if (ghState === 'pending') return ok({ error: 'authorization_pending' });
      if (ghState === 'slow') return ok({ error: 'slow_down', interval: ghInterval });
      if (ghState === 'denied') return ok({ error: 'access_denied' });
      return ok({ access_token: 'gho-x' });
    }
    if (url.endsWith('/user')) return ok(ghUser);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mk = (env = {}, kv2) => {
    const k = kv2 || new MemKV({ users: { alice: sha('ta') } });
    const c2 = new RelayCore({ kv: k, config: configFromEnv({ PUBLIC_URL: 'https://r.test', GITHUB_CLIENT_ID: 'cid', ...env }), fetchImpl: fakeFetch, now: () => clock });
    return { core: c2, kv: k, op: (ip = '1.1.1.1') => { const c = new FakeConn(); c2.openConn(c, { ip }); return c; } };
  };
  const post = (w, path, body, ip = '9.9.9.9') => w.core.handleHttp({ method: 'POST', path, body: JSON.stringify(body), ip }).then(r => ({ ...r, j: JSON.parse(r.body) }));
  const get = (w, path) => w.core.handleHttp({ method: 'GET', path, body: '', ip: '' }).then(r => ({ ...r, j: JSON.parse(r.body) }));
  const helloOn = (w, user, token, ip) => { const c = w.op(ip); w.core.onMessage(c, JSON.stringify({ t: 'hello', user, token })); return c; };

  const w = mk();
  const info = await get(w, '/v1/info');
  check('/v1/info with client id', info.j.github === true && info.j.publicUrl === 'https://r.test' && info.j.protocol === 3 && info.j.minClientVersion === '');
  check('/v1/info without client id', (await get(mk({ GITHUB_CLIENT_ID: '' }), '/v1/info')).j.github === false);
  check('start without client id -> 404', (await post(mk({ GITHUB_CLIENT_ID: '' }), '/v1/auth/github/start', {})).status === 404);

  const st = (await post(w, '/v1/auth/github/start', { label: 'my\x07 laptop' })).j;
  check('start returns poll id + user code', st.status === 'started' && st.user_code === 'UC-1' && !!st.poll_id);
  const before = calls;
  check('poll too early -> pending without calling GitHub', (await post(w, '/v1/auth/github/poll', { poll_id: st.poll_id })).j.status === 'pending' && calls === before);
  clock += 6000;
  check('poll when GitHub says pending -> pending', (await post(w, '/v1/auth/github/poll', { poll_id: st.poll_id })).j.status === 'pending');
  ghState = 'slow'; ghInterval = 12; clock += 6000;
  const slow = (await post(w, '/v1/auth/github/poll', { poll_id: st.poll_id })).j;
  check('slow_down raises the interval', slow.status === 'pending' && slow.interval === 12);
  ghState = 'ok'; clock += 13000;
  const ok1 = (await post(w, '/v1/auth/github/poll', { poll_id: st.poll_id })).j;
  check('success returns user + sst_ token', ok1.status === 'ok' && ok1.user === 'dana' && ok1.token.startsWith('sst_'));
  check('account, gh index and device stored', !!w.kv.get('account:dana') && w.kv.get('gh:11') === 'dana' && w.kv.list('device:').length === 1);
  check('device label sanitized', w.kv.list('device:')[0][1].label === 'my laptop');
  check('no GitHub token stored anywhere', !JSON.stringify([...w.kv.m]).includes('gho-x'));
  const s1 = helloOn(w, 'dana', ok1.token);
  check('device token authenticates a hello', last(s1, 'welcome')?.user === 'dana' && last(s1, 'welcome')?.protocol === 3);
  const s1b = helloOn(w, '', ok1.token);
  check('device token works without a user field', last(s1b, 'welcome')?.user === 'dana');
  const mismatch = helloOn(w, 'alice', ok1.token);
  check('sst_ token with mismatched user -> auth fail', last(mismatch, 'error')?.code === 'auth' && mismatch.closed?.c === 4003);

  // a second login by the same GitHub id -> same username, second device
  const st2 = (await post(w, '/v1/auth/github/start', {})).j;
  clock += 6000;
  ghUser.login = 'DanaRenamed';
  const ok2 = (await post(w, '/v1/auth/github/poll', { poll_id: st2.poll_id })).j;
  check('second login: same username, second device', ok2.user === 'dana' && ok2.token !== ok1.token && w.kv.list('device:').length === 2);
  check('ghLogin refreshed but name unchanged', w.kv.get('account:dana').ghLogin === 'DanaRenamed');

  // revoke closes the live conn and kills the token
  const adm = helloOn(w, 'dana', ok2.token);
  const live = helloOn(w, 'dana', ok1.token);
  w.core.onMessage(adm, JSON.stringify({ t: 'device_list' }));
  const devs = last(adm, 'devices').devices;
  check('device_list marks the current device', devs.length === 2 && devs.filter(d => d.current).length === 1);
  const victim = devs.find(d => !d.current);
  w.core.onMessage(adm, JSON.stringify({ t: 'device_revoke', id: victim.id }));
  check('device_revoke replies', last(adm, 'device_revoked')?.id === victim.id);
  check('revoked device conn closed with 4003', live.closed?.c === 4003);
  check('revoked token no longer works', last(helloOn(w, 'dana', ok1.token), 'error')?.code === 'auth');
  w.core.onMessage(adm, JSON.stringify({ t: 'device_revoke', id: 'nope' }));
  check('revoking a device you do not own -> not_found', last(adm, 'error')?.code === 'not_found');

  // denied, name_taken
  ghState = 'denied';
  const st3 = (await post(w, '/v1/auth/github/start', {})).j; clock += 6000;
  check('access_denied -> denied', (await post(w, '/v1/auth/github/poll', { poll_id: st3.poll_id })).j.status === 'denied');
  ghState = 'ok'; ghUser.id = 12; ghUser.login = 'Alice';
  const st4 = (await post(w, '/v1/auth/github/start', {})).j; clock += 6000;
  const taken = (await post(w, '/v1/auth/github/poll', { poll_id: st4.poll_id })).j;
  check('GitHub login colliding with a legacy user -> name_taken', taken.status === 'error' && taken.code === 'name_taken');
  check('expired / unknown poll id -> expired', (await post(w, '/v1/auth/github/poll', { poll_id: 'zzz' })).j.status === 'expired');
  const bj = await w.core.handleHttp({ method: 'POST', path: '/v1/auth/github/start', body: '{nope', ip: '1' });
  check('bad JSON -> 400', bj.status === 400);

  // per-IP auth failure limiter
  const w2 = mk();
  for (let i = 0; i < 20; i++) helloOn(w2, 'alice', 'wrong', '7.7.7.7');
  const blocked = helloOn(w2, 'alice', 'ta', '7.7.7.7');
  check('20 auth failures from one IP -> 4029', blocked.closed?.c === 4029);
  check('other IPs unaffected', last(helloOn(w2, 'alice', 'ta', '8.8.8.8'), 'welcome')?.user === 'alice');
}

{
  const w = world();
  check('hasPendingState false when empty', w.core.hasPendingState() === false);
  const a = w.hi('alice', 'ta'); w.sy(a, { t: 'pair_create', chat: 'web' });
  check('hasPendingState true with an open invite', w.core.hasPendingState() === true);
}

// ---- AUDIT_TEXT=0 keeps message text out of the audit log ----
{
  const w = world({ AUDIT_TEXT: '0' });
  const a = w.hi('alice', 'ta'); const b = w.hi('bob', 'tb');
  w.sy(a, { t: 'pair_create', chat: 'web' }); const code = last(a, 'pair_code').code;
  w.sy(b, { t: 'pair_accept', code, chat: 'api' }); w.sy(a, { t: 'pair_decision', code, ok: true });
  const sa = w.hi('alice', 'ta'); w.core.onClose(sa); // keep helper symmetrical; real sessions below
  const mk = (u, t, ch) => { const c = w.op(); w.core.onMessage(c, JSON.stringify({ t: 'hello', user: u, token: t, chat: ch })); return c; };
  const s1 = mk('alice', 'ta', 'web'); mk('bob', 'tb', 'api');
  w.sy(s1, { t: 'msg', id: 'x1', parts: [{ kind: 'text', text: 'SECRET-TEXT' }] });
  const rec = w.kv.audit.find(r => r.ev === 'msg');
  check('AUDIT_TEXT=0: msg audit record exists without text', !!rec && !('text' in rec) && !JSON.stringify(w.kv.audit).includes('SECRET-TEXT'));
}

// ---- T5: zombie takeover ----
{
  const w = world();
  const a = w.hi('alice', 'ta'); const b = w.hi('bob', 'tb');
  w.sy(a, { t: 'pair_create', chat: 'web' }); const code = last(a, 'pair_code').code;
  w.sy(b, { t: 'pair_accept', code, chat: 'api' }); w.sy(a, { t: 'pair_decision', code, ok: true });
  const sess = (u, t) => { const c = w.op(); c.lastActivity = () => c.activity ?? clock; w.core.onMessage(c, JSON.stringify({ t: 'hello', v: 2, user: u, token: t, chat: u === 'alice' ? 'web' : 'api' })); return c; };
  const s1 = sess('alice', 'ta');
  check('session hello with v:2 is accepted', last(s1, 'welcome')?.mode === 'session' && s1.meta.v === 2);
  const s2 = sess('alice', 'ta');
  check('live duplicate session is refused', last(s2, 'error')?.code === 'duplicate' && s2.closed?.c === 4006);
  s1.activity = clock - 80000; // silent for 80 s: a zombie
  const s3 = sess('alice', 'ta');
  check('zombie session is replaced (old closed 4008)', s1.closed?.c === 4008 && last(s3, 'welcome')?.mode === 'session');
}

// ---- T5: browser confirmation (core level) ----
{
  const cfgOn = (env = {}) => configFromEnv({ PUBLIC_URL: 'https://r.test', GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'sec', CONFIRM_TTL_MS: '60000', ...env });
  const kv5 = new MemKV({ users: { alice: sha('ta') } });
  // two GitHub accounts, each with a device token
  for (const [n, id, tok] of [['dana', 7, 'sst_dana'], ['eli', 8, 'sst_eli']]) {
    kv5.put('account:' + n, { name: n, ghId: id, ghLogin: n }); kv5.put('gh:' + id, n);
    kv5.put('device:' + sha(tok), { id: 'dev-' + n, user: n, label: 'x', createdAt: 0, lastSeenAt: clock });
  }
  const core5 = new RelayCore({ kv: kv5, config: cfgOn(), now: () => clock });
  const adm = (u, t, v = 3) => { const c = new FakeConn(); core5.openConn(c, { ip: '2.2.2.2' }); core5.onMessage(c, JSON.stringify({ t: 'hello', v, user: u, token: t })); return c; };
  const sy5 = (c, o) => core5.onMessage(c, JSON.stringify(o));
  check('needsConfirm is false for legacy users, true for GitHub accounts', core5.needsConfirm('alice') === false && core5.needsConfirm('dana') === true);
  check('needsConfirm is false when CONFIRM_LINKS=off', new RelayCore({ kv: kv5, config: cfgOn({ CONFIRM_LINKS: 'off' }), now: () => clock }).needsConfirm('dana') === false);
  check('auto without a secret leaves confirmation off', new RelayCore({ kv: new MemKV(), config: configFromEnv({ GITHUB_CLIENT_ID: 'cid' }) }).confirmEnabled() === false);
  let threw = '';
  try { new RelayCore({ kv: new MemKV(), config: configFromEnv({ CONFIRM_LINKS: 'on', GITHUB_CLIENT_ID: 'cid' }) }); } catch (e) { threw = e.message; }
  check('CONFIRM_LINKS=on without a secret throws', /GITHUB_CLIENT_SECRET/.test(threw), threw);

  const d1 = adm('dana', 'sst_dana'); const e1 = adm('eli', 'sst_eli');
  sy5(d1, { t: 'pair_create', chat: 'web' }); const code5 = last(d1, 'pair_code').code;
  sy5(e1, { t: 'pair_accept', code: code5, chat: 'api' });
  const cr = last(e1, 'confirm_required');
  check('pair_accept on a GitHub account is parked', !!cr && !last(e1, 'pair_waiting') && cr.expiresInSec === 60 && cr.url.startsWith('https://r.test/c/'));
  check('bad code still fails immediately (no confirm)', (() => { const x = adm('eli', 'sst_eli'); sy5(x, { t: 'pair_accept', code: 'zzzzz-zzzzz', chat: 'q' }); return last(x, 'error')?.code === 'bad_code' && !last(x, 'confirm_required'); })());
  check('a parked confirm lists as pending state (keeps the DO alarm alive)', core5.hasPendingState());
  clock += 61000; core5.sweep();
  check('expired confirm is swept and confirm_expired is sent', last(e1, 'confirm_expired')?.id === cr.id && kv5.list('confirm:').length === 0);
  check('...and the invite was never touched', kv5.get('invite:' + code5.replace('-', '')).requester === null);

  const r1 = await core5.handleHttp({ method: 'GET', path: '/c/' + cr.id, query: '', headers: {}, body: '', ip: '' });
  check('expired confirm page is 404', r1.status === 404);
  const forged = core5.signSession({ u: 'eli', gh: 8, exp: clock + 1e6 });
  check('a valid session cookie is accepted, a tampered one is not', core5.readSession('ss_web=' + forged)?.u === 'eli' && core5.readSession('ss_web=' + forged.slice(0, -2) + 'AA') === null);
  check('an expired session cookie is rejected', core5.readSession('ss_web=' + core5.signSession({ u: 'eli', gh: 8, exp: clock - 1 })) === null);
  for (let i = 0; i < 5; i++) { sy5(d1, { t: 'pair_create', chat: 'c' + i }); }
  const codes5 = d1.sent.filter(m => m.t === 'pair_code').slice(-5).map(m => m.code);
  const e2 = adm('eli', 'sst_eli');
  for (let i = 0; i < 6; i++) sy5(e2, { t: 'pair_accept', code: codes5[i % 5], chat: 'x' + i });
  check('at most 5 open confirms per user (too_many_confirms)', e2.sent.filter(m => m.t === 'confirm_required').length === 5 && last(e2, 'error')?.code === 'too_many_confirms', JSON.stringify(e2.sent.map(m => m.t + ':' + (m.code || ''))));
}

// ---- T6: directed invites ----
{
  const kv6 = new MemKV({ users: { alice: sha('ta'), bob: sha('tb'), Carol: sha('tc') } });
  const core6 = new RelayCore({ kv: kv6, config: configFromEnv({ PUBLIC_URL: 'https://r.test', MAX_OPEN_INVITES: '100' }), now: () => clock });
  const adm6 = (u, t, ip = '3.3.3.3') => { const c = new FakeConn(); core6.openConn(c, { ip }); core6.onMessage(c, JSON.stringify({ t: 'hello', v: 3, user: u, token: t })); return c; };
  const sy6 = (c, o) => core6.onMessage(c, JSON.stringify(o));
  const al = adm6('alice', 'ta'); const bo = adm6('bob', 'tb'); const ca = adm6('Carol', 'tc');
  sy6(al, { t: 'pair_create', chat: 'web', for: '@Bob' });
  const dc = last(al, 'pair_code');
  check('directed invite: the named user (with or without @, any case) gets invite_for_you at once', last(bo, 'invite_for_you')?.code === dc.code && last(bo, 'invite_for_you')?.from.user === 'alice' && !last(ca, 'invite_for_you'));
  sy6(ca, { t: 'pair_accept', code: dc.code, chat: 'x' });
  check('directed invite: only the named user can accept (others get not_for_you)', last(ca, 'error')?.code === 'not_for_you' && !last(ca, 'pair_waiting'));
  check('wrong user gets not_for_you and it counts toward the limiter', (() => {
    const evil = adm6('Carol', 'tc', '4.4.4.4');
    for (let i = 0; i < 10; i++) sy6(evil, { t: 'pair_accept', code: dc.code, chat: 'x' + i });
    return last(evil, 'error')?.code === 'too_many_attempts';
  })());
  const ghost = (() => { sy6(al, { t: 'pair_create', chat: 'web2', for: 'nobody-here' }); return last(al, 'pair_code'); })();
  const real = (() => { sy6(al, { t: 'pair_create', chat: 'web3', for: 'bob' }); return last(al, 'pair_code'); })();
  check('directed invite to a nonexistent user gets the same reply as to a real one', Object.keys(ghost).sort().join() === Object.keys(real).sort().join() && /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(ghost.code) && !al.sent.some(m => m.t === 'error' && m.code === 'bad_target'));
  sy6(bo, { t: 'list_requests' });
  const rq = last(bo, 'requests');
  check('incoming invites listed for the target', rq.incoming.length === 2 && rq.incoming.every(i => i.from.user === 'alice' && i.url.startsWith('https://r.test/j/')) && rq.incoming.some(i => i.code === dc.code));
  sy6(al, { t: 'list_requests' });
  check('the sender does not see their own invites as incoming', last(al, 'requests').incoming.length === 0);
  sy6(al, { t: 'pair_create', chat: 'self', for: 'alice' });
  check('inviting yourself -> bad_target', last(al, 'error')?.code === 'bad_target');
  sy6(al, { t: 'pair_create', chat: 'bad', for: 'no spaces allowed' });
  check('an invalid username -> bad_target', last(al, 'error')?.code === 'bad_target');
  const inf = await core6.handleHttp({ method: 'GET', path: '/v1/invite/' + dc.code, body: '', ip: '' });
  const pg = await core6.handleHttp({ method: 'GET', path: '/j/' + dc.code, body: '', ip: '' });
  check('invite JSON and join page say who it is for', JSON.parse(inf.body).for === 'bob' && /This invite is for @bob/.test(pg.body));
  sy6(bo, { t: 'pair_accept', code: dc.code, chat: 'api' });
  check('the named user can accept', !!last(bo, 'pair_waiting'));
  sy6(bo, { t: 'list_requests' });
  check('a used directed invite is no longer "incoming"', !last(bo, 'requests').incoming.some(i => i.code === dc.code));
  // limit
  const fresh = adm6('alice', 'ta', '6.6.6.6');
  let n = 0; for (let i = 0; i < 25; i++) { sy6(fresh, { t: 'pair_create', chat: 'lim' + i, for: 'bob' }); if (fresh.sent.filter(m => m.t === 'pair_code').length > n) n++; }
  check('21st directed invite in a day -> too_many_directed', last(fresh, 'error')?.code === 'too_many_directed' && n === 17, `${n}`); // 3 were already sent today: 17 more fit, the next is refused
  check('the daily counter is swept after two days', (() => { clock += 3 * 86400000; core6.sweep(); return kv6.list('dirinv:').length === 0; })());
  clock -= 3 * 86400000;
}

// ---- T7: receipt statuses ----
{
  const kv7 = new MemKV({ users: { alice: sha('ta'), bob: sha('tb') } });
  const core7 = new RelayCore({ kv: kv7, config: configFromEnv({}), now: () => clock });
  kv7.put('links', [{ id: 'L1', members: [{ user: 'alice', chat: 'web' }, { user: 'bob', chat: 'api' }], createdAt: 'x' }]);
  core7.links = kv7.get('links');
  const sess7 = (u, t, chat, v) => { const c = new FakeConn(); core7.openConn(c, { ip: '7.7.7.7' }); core7.onMessage(c, JSON.stringify({ t: 'hello', v, user: u, token: t, chat })); return c; };
  const bobS = sess7('bob', 'tb', 'api', 3);
  const aliceOld = sess7('alice', 'ta', 'web', 2);
  for (const status of ['accepted', 'shown', 'inbox', 'read']) core7.onMessage(bobS, JSON.stringify({ t: 'receipt', id: 'm1', status, to: 'alice' }));
  core7.onMessage(bobS, JSON.stringify({ t: 'receipt', id: 'm1', status: 'bogus', to: 'alice' }));
  const got = aliceOld.sent.filter(m => m.t === 'receipt').map(m => m.status);
  check('v2 sender never receives shown/inbox/read (only accepted)', got.join() === 'accepted', got.join());
  core7.onMessage(bobS, JSON.stringify({ t: 'receipt', id: 'm2', status: 'declined', to: 'alice' }));
  check('v2 sender still gets declined', aliceOld.sent.filter(m => m.t === 'receipt').map(m => m.status).join() === 'accepted,declined');
  aliceOld.close(4000); core7.onClose(aliceOld);
  const aliceNew = sess7('alice', 'ta', 'web', 3);
  for (const status of ['accepted', 'inbox', 'shown', 'read']) core7.onMessage(bobS, JSON.stringify({ t: 'receipt', id: 'm3', status, to: 'alice' }));
  check('v3 sender receives every status in order', aliceNew.sent.filter(m => m.t === 'receipt').map(m => m.status).join() === 'accepted,inbox,shown,read');
}

// ---- T10: counters and /v1/stats ----
{
  const T0 = Date.UTC(2026, 5, 10, 12, 0, 0);
  let t = T0;
  const kv10 = new MemKV({ users: { legacy1: sha('l1'), legacy2: sha('l2') } });
  const mkAcc = (n, id, tok, createdAt) => { kv10.put('account:' + n, { name: n, ghId: id, ghLogin: n, createdAt }); kv10.put('gh:' + id, n); kv10.put('device:' + sha(tok), { id: 'dev-' + n, user: n, label: 'x', createdAt, lastSeenAt: createdAt }); };
  mkAcc('zoe', 1, 'sst_zoe', T0 - 3600000);            // signed up 1 h ago
  mkAcc('yan', 2, 'sst_yan', T0 - 3 * 86400000);        // signed up 3 days ago
  mkAcc('xia', 3, 'sst_xia', T0 - 3600000);
  kv10.put('links', [
    { id: 'LINK-A-secret', members: [{ user: 'zoe', chat: 'zoechat' }, { user: 'yan', chat: 'yanchat' }], createdAt: 'x' },
    { id: 'LINK-B-secret', members: [{ user: 'xia', chat: 'xiachat' }, { user: 'yan', chat: 'yanchat2' }], createdAt: 'x' },
  ]);
  const core10 = new RelayCore({ kv: kv10, config: configFromEnv({ STATS_TOKEN: 'sekrit' }), now: () => t });
  const sess = (u, tok, chat) => { const c = new FakeConn(); core10.openConn(c, { ip: '10.0.0.1' }); core10.onMessage(c, JSON.stringify({ t: 'hello', v: 3, user: u, token: tok, chat })); return c; };
  const say10 = (c, o) => core10.onMessage(c, JSON.stringify(o));
  const zoe = sess('zoe', 'sst_zoe', 'zoechat'), yan = sess('yan', 'sst_yan', 'yanchat'), xia = sess('xia', 'sst_xia', 'xiachat'), yan2 = sess('yan', 'sst_yan', 'yanchat2');
  const today = () => kv10.get('stats:' + new Date(t).toISOString().slice(0, 10));

  say10(zoe, { t: 'msg', id: 'a1', parts: [{ kind: 'text', text: 'hi' }] });
  say10(zoe, { t: 'msg', id: 'a2', parts: [{ kind: 'text', text: 'hi again' }] });
  check('delivered message counts msgs and marks the link active', today().msgs === 2 && today().active.length === 1 && today().active[0] === 'LINK-A-secret');
  check('activation counted once per account, only within 24 h', today().activated === 1 && kv10.get('account:zoe').firstMsgAt === T0);
  say10(yan, { t: 'msg', id: 'b1', parts: [{ kind: 'text', text: 'late' }] }); // yan signed up 3 days ago
  check('a first message after 24 h is not an activation', today().activated === 1 && !!kv10.get('account:yan').firstMsgAt);
  say10(xia, { t: 'msg', id: 'c1', parts: [{ kind: 'text', text: 'second link' }] });
  check('a second link is activated and counted separately', today().activated === 2 && today().active.length === 2);
  yan2.close(4000); core10.onClose(yan2);
  say10(xia, { t: 'msg', id: 'c2', parts: [{ kind: 'text', text: 'nobody home' }] });
  check('peer_offline counts undelivered (and not msgs)', today().undelivered === 1 && today().msgs === 4);

  // earlier days: the same link on several days, plus an old link
  kv10.put('stats:2026-06-08', { msgs: 40, active: ['LINK-A-secret', 'LINK-OLD-secret'], accounts: 2, activated: 1 });
  kv10.put('stats:2026-06-09', { msgs: 40, active: ['LINK-A-secret'] });
  kv10.put('stats:2026-05-20', { msgs: 9, active: ['LINK-ANCIENT-secret'] });
  const rep = statsReport(kv10, t);
  check('wal counts distinct links over 7 days, not messages', rep.wal === 3 && rep.days.find(d => d.date === '2026-06-08').activeLinks === 2, JSON.stringify(rep));
  check('activation7d sums accounts and activated over 7 days', rep.activation7d.activated === 3 && rep.activation7d.accounts === 2, JSON.stringify(rep.activation7d));
  const flat = JSON.stringify(rep);
  check('report contains no user names, chat labels or link ids', !/zoe|yan|xia|legacy|chat|LINK-|secret|sst_/i.test(flat.replace(/activation|activated|activeLinks/g, '')), flat);

  const get10 = (headers, ip = '9.9.9.9') => core10.handleHttp({ method: 'GET', path: '/v1/stats', headers, body: '', ip });
  const off = new RelayCore({ kv: new MemKV(), config: configFromEnv({}), now: () => t });
  check('/v1/stats is 404 without STATS_TOKEN', (await off.handleHttp({ method: 'GET', path: '/v1/stats', headers: { authorization: 'Bearer x' }, body: '', ip: '' })).status === 404);
  check('/v1/stats is 401 with no or a wrong token', (await get10({})).status === 401 && (await get10({ authorization: 'Bearer nope' })).status === 401);
  const good = await get10({ authorization: 'Bearer sekrit' });
  check('/v1/stats is 200 with the right token and returns the report', good.status === 200 && JSON.parse(good.body).wal === 3);
  let last429 = 0; for (let i = 0; i < 30; i++) last429 = (await get10({ authorization: 'Bearer wrong' }, '8.8.8.8')).status;
  check('wrong stats tokens are rate limited per IP', last429 === 429);

  t += 100 * 86400000; core10.sweep();
  check('stats older than 90 days are swept', kv10.list('stats:').length === 0 || kv10.list('stats:').every(([k]) => k.slice(6) >= new Date(t - 90 * 86400000).toISOString().slice(0, 10)));
  check('...including the ancient one', !kv10.get('stats:2026-05-20'));
}

// ---- T2: client version gate ----
{
  const mkv = (env) => { const k = new MemKV({ users: { alice: sha('ta') } }); const c2 = new RelayCore({ kv: k, config: configFromEnv({ ...env }), now: () => clock }); return { c2, k }; };
  const hi = (c2, extra) => { const c = new FakeConn(); c2.openConn(c, { ip: '5.5.5.5' }); c2.onMessage(c, JSON.stringify({ t: 'hello', v: 3, user: 'alice', token: 'ta', ...extra })); return c; };
  const g = mkv({ MIN_CLIENT_VERSION: '0.3.0' });
  const old = hi(g.c2, { clientVersion: '0.2.1' });
  check('hello with clientVersion below MIN_CLIENT_VERSION -> upgrade_required + 4010', last(old, 'error')?.code === 'upgrade_required' && last(old, 'error')?.minVersion === '0.3.0' && old.closed?.c === 4010 && !last(old, 'welcome'));
  check('hello without clientVersion is refused when a minimum is set', hi(g.c2, {}).closed?.c === 4010);
  check('hello at the minimum is accepted', last(hi(g.c2, { clientVersion: '0.3.0' }), 'welcome')?.mode === 'admin');
  check('0.10.0 is newer than 0.9.0 (numeric compare)', last(hi(mkv({ MIN_CLIENT_VERSION: '0.9.0' }).c2, { clientVersion: '0.10.0' }), 'welcome') !== undefined);
  const free = mkv({});
  check('hello without clientVersion is allowed when no minimum is set', last(hi(free.c2, {}), 'welcome')?.mode === 'admin');
  const infoOf = async (c2) => JSON.parse((await c2.handleHttp({ method: 'GET', path: '/v1/info', body: '', ip: '' })).body);
  const gi = await infoOf(g.c2);
  check('/v1/info reports protocol 3 and minClientVersion', gi.protocol === 3 && gi.minClientVersion === '0.3.0');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
