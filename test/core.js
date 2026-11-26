// Unit tests for RelayCore: no network, no files. Run: node test/core.js
import crypto from 'node:crypto';
import { RelayCore, configFromEnv } from '../relay/core.js';
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
  check('/v1/info with client id', info.j.github === true && info.j.publicUrl === 'https://r.test' && info.j.protocol === 2);
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
  check('device token authenticates a hello', last(s1, 'welcome')?.user === 'dana' && last(s1, 'welcome')?.protocol === 2);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
