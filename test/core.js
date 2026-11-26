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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
