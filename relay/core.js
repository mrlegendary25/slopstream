// RelayCore: ALL protocol logic of the slopstream relay, platform-neutral.
// - authenticates users (token per user)
// - groups 2+ chats into one "link" (a shared group), approved by a human each time someone joins
// - delivers messages ONLY if the target's linked session is connected right now (no queueing)
// - rate limits, size caps, audit log
//
// Hosts (relay/server.js for Node, relay/cloudflare for Workers) only provide sockets, a KV store and a
// periodic sweep(). No ws, no fs, no timers in here, so the same code runs in both places.
// Wire format is A2A-shaped (contextId + parts[]) but this is NOT full A2A yet.

import crypto from 'node:crypto';

export const PROTOCOL = 2;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no i, l, o, 0, 1: hard to misread
const ACCEPT_FAIL_MAX = 10;
const ACCEPT_FAIL_WINDOW_MS = 10 * 60 * 1000;
const NAME_RE = /^[a-zA-Z0-9._-]{1,40}$/;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const key = (user, chat) => `${user} ${chat}`;
const normCode = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const displayCode = (c) => c.slice(0, 5) + '-' + c.slice(5);

const str = (v, d) => (v === undefined || v === null ? d : String(v).trim());
const num = (v, d) => (v === undefined || v === null || String(v).trim() === '' ? d : Number(v));

export function configFromEnv(env) {
  return {
    maxText: num(env.MAX_TEXT, 8000),
    rateMax: num(env.RATE_MAX, 30), // msgs per link per window
    rateWindowMs: num(env.RATE_WINDOW_MS, 10 * 60 * 1000),
    maxGroupSize: num(env.MAX_GROUP_SIZE, 3), // how many chats can share one link
    publicUrl: str(env.PUBLIC_URL, '').replace(/\/+$/, ''),
    inviteTtlMs: num(env.INVITE_TTL_MS, 24 * 60 * 60 * 1000),
    githubClientId: str(env.GITHUB_CLIENT_ID, ''),
    githubBaseUrl: str(env.GITHUB_BASE_URL, 'https://github.com').replace(/\/+$/, ''),
    githubApiUrl: str(env.GITHUB_API_URL, 'https://api.github.com').replace(/\/+$/, ''),
    auditText: str(env.AUDIT_TEXT, '1') !== '0',
    maxOpenInvites: num(env.MAX_OPEN_INVITES, 20),
    maxDevices: num(env.MAX_DEVICES, 20),
    maxLinks: num(env.MAX_LINKS, 50),
  };
}

export class RelayCore {
  constructor({ kv, config, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    this.kv = kv;
    this.config = config;
    this.fetch = fetchImpl;
    this.now = now;
    // A "link" is a group of 2..maxGroupSize chats that have all agreed to be reachable from one another.
    // { id, members: [{user, chat}, ...], createdAt }
    this.links = kv.get('links') || [];
    this.conns = new Map();   // conn id -> conn
    this.online = new Map();  // "user chat" -> conn id (session connections only)
    this.rate = new Map();    // linkId -> [timestamps]
    this.acceptFails = new Map(); // user -> [timestamps of bad pair_accept codes]
  }

  // ---- host-facing API ----
  openConn(conn, { ip = '' } = {}) {
    conn.meta = { id: crypto.randomUUID(), openedAt: this.now(), ip, authed: false };
    conn.saveMeta();
    this.conns.set(conn.meta.id, conn);
  }

  // A Durable Object can wake up holding sockets the core has never seen; rebuild our in-memory index from meta.
  restoreConn(conn) {
    const m = conn.meta;
    this.conns.set(m.id, conn);
    if (m.mode === 'session') this.online.set(key(m.user, m.chat), m.id);
  }

  onMessage(conn, raw) {
    if (!this.conns.has(conn.meta.id)) this.restoreConn(conn);
    if (raw.length > 65536) return conn.close(1009, 'too big');
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') return conn.send({ t: 'pong' });
    conn.meta.lastMsgAt = this.now(); // roughly right is enough, so no saveMeta per frame
    if (!conn.meta.authed) {
      if (m.t !== 'hello') return conn.close(4002, 'hello first');
      return this.handleHello(conn, m);
    }
    try { this.handle(conn, m); } catch (e) { conn.send({ t: 'error', code: 'internal', message: String(e.message || e) }); }
  }

  onClose(conn) {
    const meta = conn.meta;
    if (!meta || !this.conns.has(meta.id)) return;
    this.conns.delete(meta.id);
    if (meta.mode === 'session') {
      const k = key(meta.user, meta.chat);
      if (this.online.get(k) === meta.id) {
        this.online.delete(k);
        const link = this.findLink(meta.user, meta.chat);
        if (link) this.broadcastMembers(link);
        this.audit({ ev: 'offline', user: meta.user, chat: meta.chat });
      }
    }
  }

  sweep() {
    const now = this.now();
    for (const c of [...this.conns.values()]) {
      if (!c.meta.authed && now - c.meta.openedAt > 10000) c.close(4001, 'hello timeout');
    }
    for (const [id, arr] of this.rate) {
      const fresh = arr.filter(t => now - t < this.config.rateWindowMs);
      if (fresh.length) this.rate.set(id, fresh); else this.rate.delete(id);
    }
    for (const [k, inv] of this.kv.list('invite:')) if (inv.exp < now) this.kv.del(k);
    for (const [u, arr] of this.acceptFails) {
      const fresh = arr.filter(t => now - t < ACCEPT_FAIL_WINDOW_MS);
      if (fresh.length) this.acceptFails.set(u, fresh); else this.acceptFails.delete(u);
    }
  }

  async handleHttp(req) {
    if (req.method === 'GET' && req.path === '/healthz') {
      return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, protocol: PROTOCOL }) };
    }
    return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };
  }

  // ---- helpers ----
  audit(o) {
    if (o.ev === 'msg' && !this.config.auditText) { const { text, ...rest } = o; o = rest; }
    this.kv.appendAudit({ ts: new Date(this.now()).toISOString(), ...o });
  }
  newCode() {
    let c = '';
    for (let i = 0; i < 10; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    return c;
  }
  // Returns the invite, or undefined if missing or expired (expired ones are deleted on the spot).
  getInvite(code) {
    const c = normCode(code);
    const inv = c ? this.kv.get('invite:' + c) : undefined;
    if (!inv) return undefined;
    if (inv.exp < this.now()) { this.kv.del('invite:' + c); return undefined; }
    return inv;
  }
  userInvites(user) { return this.kv.list('invite:').map(([, v]) => v).filter(v => v.user === user && v.exp >= this.now()); }
  adminConnsOf(user) { return [...this.conns.values()].filter(c => c.meta.authed && c.meta.mode === 'admin' && c.meta.user === user); }
  githubOf(user) { return this.kv.get('account:' + user)?.ghLogin || null; }
  makeInvite(conn, chat, groupId) {
    const user = conn.meta.user;
    const { maxOpenInvites, inviteTtlMs, publicUrl } = this.config;
    if (this.userInvites(user).length >= maxOpenInvites) { conn.send({ t: 'error', code: 'too_many_invites', message: `you already have ${maxOpenInvites} open invites; cancel some first` }); return; }
    const code = this.newCode();
    const createdAt = this.now();
    this.kv.put('invite:' + code, { code, kind: groupId ? 'group' : 'pair', user, chat, groupId: groupId || null, createdAt, exp: createdAt + inviteTtlMs, requester: null });
    conn.send({ t: 'pair_code', code: displayCode(code), url: `${publicUrl}/j/${displayCode(code)}`, expiresInSec: inviteTtlMs / 1000 });
  }
  connOf(user, chat) { const id = this.online.get(key(user, chat)); return id ? this.conns.get(id) : undefined; }
  findLink(user, chat) { return this.links.find(l => l.members.some(m => m.user === user && m.chat === chat)); }
  saveLinks() { this.kv.put('links', this.links); }
  otherMembers(link, user, chat) {
    return link.members
      .filter(m => !(m.user === user && m.chat === chat))
      .map(m => {
        const w = this.connOf(m.user, m.chat);
        return { user: m.user, chat: m.chat, online: !!w, agent: w ? w.meta.agent : null };
      });
  }
  // Push each currently-online member of `link` a fresh list of everyone else in it (membership or presence changed).
  broadcastMembers(link) {
    for (const m of link.members) {
      const w = this.connOf(m.user, m.chat);
      if (w) w.send({ t: 'members', members: this.otherMembers(link, m.user, m.chat) });
    }
  }
  rateOk(linkId) {
    const now = this.now();
    const arr = (this.rate.get(linkId) || []).filter(t => now - t < this.config.rateWindowMs);
    if (arr.length >= this.config.rateMax) { this.rate.set(linkId, arr); return false; }
    arr.push(now); this.rate.set(linkId, arr); return true;
  }

  // ---- protocol ----
  handleHello(conn, m) {
    const meta = conn.meta;
    const users = this.kv.get('users') || {}; // re-read on every hello so `admin add-user` works without a restart
    const user = String(m.user || '');
    const stored = Object.hasOwn(users, user) ? users[user] : undefined;
    const given = hashToken(String(m.token || ''));
    const ok = stored && stored.length === given.length &&
      crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(given));
    if (!ok) { this.audit({ ev: 'auth_fail', user }); conn.send({ t: 'error', code: 'auth', message: 'bad user or token' }); return conn.close(4003, 'auth'); }
    meta.authed = true; meta.user = user;
    // Which kind of agent is behind this session (claude, codex, console...). Informational only.
    meta.agent = /^[a-z0-9_-]{1,20}$/.test(String(m.agent || '')) ? String(m.agent) : 'unknown';

    if (!m.chat) { meta.mode = 'admin'; conn.saveMeta(); return conn.send({ t: 'welcome', mode: 'admin' }); }

    const chat = String(m.chat);
    if (!NAME_RE.test(chat)) { conn.send({ t: 'error', code: 'bad_chat', message: 'invalid chat label' }); return conn.close(4004, 'bad chat'); }
    const link = this.findLink(user, chat);
    if (!link) { conn.send({ t: 'error', code: 'not_linked', message: `chat "${chat}" has no link; pair it with the slopstream CLI` }); return conn.close(4005, 'not linked'); }
    const k = key(user, chat);
    if (this.online.has(k)) { conn.send({ t: 'error', code: 'duplicate', message: 'this chat is already connected elsewhere' }); return conn.close(4006, 'duplicate'); }
    meta.mode = 'session'; meta.chat = chat; meta.linkId = link.id;
    conn.saveMeta();
    this.online.set(k, meta.id);
    conn.send({ t: 'welcome', mode: 'session', link: { id: link.id }, members: this.otherMembers(link, user, chat) });
    this.broadcastMembers(link); // tell everyone else in the group this chat just came online
    this.audit({ ev: 'online', user, chat, linkId: link.id });
  }

  handle(conn, m) {
    if (conn.meta.mode === 'admin') return this.handleAdmin(conn, m);
    if (conn.meta.mode === 'session') return this.handleSession(conn, m);
  }

  handleAdmin(conn, m) {
    const user = conn.meta.user;
    const { maxGroupSize } = this.config;
    const err = (code, message) => conn.send({ t: 'error', code, message });
    switch (m.t) {
      case 'pair_create': {
        const chat = String(m.chat || '');
        if (!NAME_RE.test(chat)) return err('bad_chat', 'invalid chat label');
        if (this.findLink(user, chat)) return err('already_linked', `chat "${chat}" is already linked`);
        this.makeInvite(conn, chat, null);
        return this.audit({ ev: 'pair_create', user, chat });
      }
      case 'invite_create': {
        // Add a NEW chat to a group that already has at least one link, up to maxGroupSize.
        const chat = String(m.chat || '');
        if (!NAME_RE.test(chat)) return err('bad_chat', 'invalid chat label');
        const link = this.findLink(user, chat);
        if (!link) return err('not_linked', `chat "${chat}" is not linked yet; use pair-create first`);
        if (link.members.length >= maxGroupSize) return err('group_full', `this group already has the maximum of ${maxGroupSize} chats`);
        this.makeInvite(conn, chat, link.id);
        return this.audit({ ev: 'invite_create', user, chat, linkId: link.id });
      }
      case 'pair_accept': {
        const chat = String(m.chat || '');
        if (!NAME_RE.test(chat)) return err('bad_chat', 'invalid chat label');
        // Brute-force limiter: codes are ~49 bits, but nobody gets unlimited guesses.
        const now = this.now();
        const fails = (this.acceptFails.get(user) || []).filter(t => now - t < ACCEPT_FAIL_WINDOW_MS);
        this.acceptFails.set(user, fails);
        if (fails.length >= ACCEPT_FAIL_MAX) return err('too_many_attempts', 'too many wrong codes; try again in a few minutes');
        const inv = this.getInvite(m.code);
        if (!inv) { fails.push(now); return err('bad_code', 'unknown or expired code'); }
        if (inv.user === user) return err('same_user', 'cannot pair with yourself');
        if (this.findLink(user, chat)) return err('already_linked', `chat "${chat}" is already linked`);
        if (inv.requester) return err('busy', 'code already in use');
        if (inv.groupId) {
          const group = this.links.find(l => l.id === inv.groupId);
          if (!group) return err('gone', 'that group no longer exists');
          if (group.members.length >= maxGroupSize) return err('group_full', `this group already has the maximum of ${maxGroupSize} chats`);
          if (group.members.some(x => x.user === user)) return err('already_in_group', 'you already have a chat in this group');
        }
        inv.requester = { user, chat, at: now };
        this.kv.put('invite:' + inv.code, inv);
        const msg = { t: 'pair_request', code: displayCode(inv.code), from: { user, chat, github: this.githubOf(user) }, toChat: inv.chat };
        for (const c of this.adminConnsOf(inv.user)) c.send(msg); // the inviter's human must approve
        conn.send({ t: 'pair_waiting', code: displayCode(inv.code), message: `waiting for ${inv.user} to approve` });
        this.audit({ ev: 'pair_request', from: user, fromChat: chat, to: inv.user, toChat: inv.chat });
        return;
      }
      case 'pair_decision': {
        const inv = this.getInvite(m.code);
        if (!inv || inv.user !== user || !inv.requester) return err('bad_code', 'no such pending request');
        this.kv.del('invite:' + inv.code); // single use, even when denied
        const dcode = displayCode(inv.code);
        const req = inv.requester;
        const toBoth = (o) => { for (const c of [...this.adminConnsOf(inv.user), ...this.adminConnsOf(req.user)]) c.send(o); };
        if (!m.ok) { toBoth({ t: 'pair_denied', code: dcode }); this.audit({ ev: 'pair_denied', user: inv.user }); return; }

        const countLinks = (u) => this.links.filter(l => l.members.some(x => x.user === u)).length;
        const limited = inv.groupId ? [req.user] : [inv.user, req.user];
        if (limited.some(u => countLinks(u) >= this.config.maxLinks)) return toBoth({ t: 'error', code: 'too_many_links', message: 'a user is at the maximum number of links' });
        let link;
        if (inv.groupId) {
          link = this.links.find(l => l.id === inv.groupId);
          if (!link) return toBoth({ t: 'error', code: 'gone', message: 'that group no longer exists' });
          if (link.members.length >= maxGroupSize) return toBoth({ t: 'error', code: 'group_full', message: 'group is now full' });
          link.members.push({ user: req.user, chat: req.chat });
        } else {
          link = { id: crypto.randomUUID(), members: [{ user: inv.user, chat: inv.chat }, { user: req.user, chat: req.chat }], createdAt: new Date(this.now()).toISOString() };
          this.links.push(link);
        }
        this.saveLinks();
        this.audit({ ev: inv.groupId ? 'member_added' : 'paired', linkId: link.id, by: user, added: { user: req.user, chat: req.chat } });
        for (const c of this.adminConnsOf(inv.user)) c.send({ t: 'paired', code: dcode, link: { id: link.id }, members: this.otherMembers(link, inv.user, inv.chat) });
        for (const c of this.adminConnsOf(req.user)) c.send({ t: 'paired', code: dcode, link: { id: link.id }, members: this.otherMembers(link, req.user, req.chat) });
        this.broadcastMembers(link); // refresh anyone else already online in the group
        return;
      }
      case 'list_requests': {
        const invites = this.userInvites(user).map(v => ({
          code: displayCode(v.code), kind: v.kind, chat: v.chat, expiresAt: v.exp,
          requester: v.requester ? { user: v.requester.user, chat: v.requester.chat, github: this.githubOf(v.requester.user) } : null,
        }));
        return conn.send({ t: 'requests', invites });
      }
      case 'invite_cancel': {
        const inv = this.getInvite(m.code);
        if (!inv || inv.user !== user) return err('bad_code', 'no such invite');
        this.kv.del('invite:' + inv.code);
        return conn.send({ t: 'invite_cancelled', code: displayCode(inv.code) });
      }
      case 'list_links': {
        // Presence of a link's members is visible to the people on that link, and nobody else.
        const mine = this.links.filter(l => l.members.some(x => x.user === user))
          .map(l => ({ id: l.id, createdAt: l.createdAt, members: l.members.map(x => ({ ...x, online: this.online.has(key(x.user, x.chat)) })) }));
        return conn.send({ t: 'links', links: mine });
      }
      case 'unlink': {
        // Leaving a group: if fewer than 2 chats would remain, the whole link is dissolved for everyone.
        const chat = String(m.chat || '');
        const link = this.findLink(user, chat);
        if (!link) return err('not_linked', 'no such link');
        const remaining = link.members.filter(x => !(x.user === user && x.chat === chat));
        if (remaining.length < 2) {
          this.links = this.links.filter(l => l.id !== link.id); this.saveLinks();
          for (const side of link.members) {
            const w = this.connOf(side.user, side.chat);
            if (w) { w.send({ t: 'unlinked' }); w.close(4007, 'unlinked'); }
          }
          this.audit({ ev: 'unlinked', linkId: link.id, by: user });
        } else {
          link.members = remaining; this.saveLinks();
          const w = this.connOf(user, chat); // the leaver's own SESSION, if any (this admin connection is separate)
          if (w) { w.send({ t: 'unlinked' }); w.close(4007, 'unlinked'); }
          this.broadcastMembers(link);
          this.audit({ ev: 'left_group', linkId: link.id, by: user });
        }
        return conn.send({ t: 'unlinked_ok', chat });
      }
    }
  }

  handleSession(conn, m) {
    const { user, chat } = conn.meta;
    if (m.t === 'receipt') {
      // Tells the ORIGINAL SENDER whether the receiving HUMAN let the message through ('accepted') or refused it ('declined').
      // Fixed vocabulary only; never carries free text. `to` names the original sender (required once a group has >2 members).
      const rlink = this.findLink(user, chat);
      if (!rlink || !['accepted', 'declined'].includes(m.status)) return;
      const others = this.otherMembers(rlink, user, chat);
      const target = m.to ? others.find(o => o.user === String(m.to)) : (others.length === 1 ? others[0] : null);
      if (!target) return;
      const rw = this.connOf(target.user, target.chat);
      this.audit({ ev: 'receipt', linkId: rlink.id, from: user, to: target.user, id: String(m.id || '').slice(0, 64), status: m.status });
      if (rw) rw.send({ t: 'receipt', id: String(m.id || '').slice(0, 64), from: user, status: m.status });
      return;
    }
    if (m.t !== 'msg') return;
    const link = this.findLink(user, chat);
    const nack = (reason) => conn.send({ t: 'ack', id: m.id, delivered: false, reason });
    if (!link) return nack('not_linked');
    const text = m.parts && m.parts[0] && m.parts[0].kind === 'text' ? String(m.parts[0].text) : '';
    if (!text) return nack('empty_or_non_text');
    if (text.length > this.config.maxText) return nack(`too_long (max ${this.config.maxText} chars)`);
    if (!this.rateOk(link.id)) { this.audit({ ev: 'rate_limited', user, linkId: link.id }); return nack('rate_limited'); }

    const others = this.otherMembers(link, user, chat);
    let target;
    if (m.to) target = others.find(o => o.user === String(m.to));
    else if (others.length === 1) target = others[0];
    if (!target) return nack(others.length > 1 ? 'ambiguous_target' : 'unknown_recipient');

    const pw = this.connOf(target.user, target.chat);
    if (!pw) { this.audit({ ev: 'undelivered_offline', from: user, to: target.user, linkId: link.id }); return nack('peer_offline'); }
    const out = { t: 'msg', id: m.id, from: user, fromChat: chat, fromAgent: conn.meta.agent, contextId: String(m.contextId || m.id), parts: [{ kind: 'text', text }] };
    pw.send(out);
    this.audit({ ev: 'msg', linkId: link.id, from: user, to: target.user, id: m.id, contextId: out.contextId, text });
    conn.send({ t: 'ack', id: m.id, delivered: true, to: target.user });
  }
}
