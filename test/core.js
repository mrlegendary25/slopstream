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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
