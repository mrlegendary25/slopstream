#!/usr/bin/env node
// claude-link relay
// - authenticates users (token per user)
// - pairs one chat <-> one chat (a "link"), approved by BOTH humans
// - delivers messages ONLY if the peer's linked session is connected right now (no queueing)
// - rate limits, size caps, audit log
//
// Wire format is A2A-shaped (contextId + parts[]) but this is NOT full A2A yet.

import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA = path.resolve(process.env.DATA_DIR || './data');
const MAX_TEXT = Number(process.env.MAX_TEXT || 8000);
const RATE_MAX = Number(process.env.RATE_MAX || 30); // msgs per link per window
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 10 * 60 * 1000);
const PAIR_TTL_MS = 10 * 60 * 1000;

fs.mkdirSync(DATA, { recursive: true });
const usersFile = path.join(DATA, 'users.json');
const linksFile = path.join(DATA, 'links.json');
const auditFile = path.join(DATA, 'audit.jsonl');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };
const audit = (o) => fs.appendFileSync(auditFile, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');

let links = readJson(linksFile, []); // [{id, a:{user,chat}, b:{user,chat}, createdAt}]
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const loadUsers = () => readJson(usersFile, {}); // {name: sha256(token)}

const key = (user, chat) => `${user}\u0000${chat}`;
const online = new Map();   // key -> ws (session connections only)
const pending = new Map();  // code -> {user, chat, ws, exp, requester?}
const rate = new Map();     // linkId -> [timestamps]

const NAME_RE = /^[a-zA-Z0-9._-]{1,40}$/;

function findLink(user, chat) {
  return links.find(l => (l.a.user === user && l.a.chat === chat) || (l.b.user === user && l.b.chat === chat));
}
function peerOf(link, user, chat) {
  return link.a.user === user && link.a.chat === chat ? link.b : link.a;
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function notifyPresence(link, changedUser, changedChat) {
  const other = peerOf(link, changedUser, changedChat);
  const w = online.get(key(other.user, other.chat));
  if (w) send(w, { t: 'presence', peerOnline: online.has(key(changedUser, changedChat)) });
}

function rateOk(linkId) {
  const now = Date.now();
  const arr = (rate.get(linkId) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { rate.set(linkId, arr); return false; }
  arr.push(now); rate.set(linkId, arr); return true;
}

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.authed = false;
  const helloTimer = setTimeout(() => { if (!ws.authed) ws.close(4001, 'hello timeout'); }, 10000);

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!ws.authed) {
      if (m.t !== 'hello') return ws.close(4002, 'hello first');
      clearTimeout(helloTimer);
      return handleHello(ws, m);
    }
    try { handle(ws, m); } catch (e) { send(ws, { t: 'error', code: 'internal', message: String(e.message || e) }); }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (ws.mode === 'session') {
      const k = key(ws.user, ws.chat);
      if (online.get(k) === ws) {
        online.delete(k);
        const link = findLink(ws.user, ws.chat);
        if (link) notifyPresence(link, ws.user, ws.chat);
        audit({ ev: 'offline', user: ws.user, chat: ws.chat });
      }
    }
    for (const [code, p] of pending) if (p.ws === ws) pending.delete(code);
  });
});

function handleHello(ws, m) {
  const users = loadUsers();
  const user = String(m.user || '');
  const stored = users[user];
  const given = hashToken(String(m.token || ''));
  const ok = stored && stored.length === given.length &&
    crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(given));
  if (!ok) { audit({ ev: 'auth_fail', user }); send(ws, { t: 'error', code: 'auth', message: 'bad user or token' }); return ws.close(4003, 'auth'); }
  ws.authed = true; ws.user = user;

  if (!m.chat) { ws.mode = 'admin'; return send(ws, { t: 'welcome', mode: 'admin' }); }

  const chat = String(m.chat);
  if (!NAME_RE.test(chat)) { send(ws, { t: 'error', code: 'bad_chat', message: 'invalid chat label' }); return ws.close(4004, 'bad chat'); }
  const link = findLink(user, chat);
  if (!link) { send(ws, { t: 'error', code: 'not_linked', message: `chat "${chat}" has no link; pair it with the claude-link CLI` }); return ws.close(4005, 'not linked'); }
  const k = key(user, chat);
  if (online.has(k)) { send(ws, { t: 'error', code: 'duplicate', message: 'this chat is already connected elsewhere' }); return ws.close(4006, 'duplicate'); }
  ws.mode = 'session'; ws.chat = chat; ws.linkId = link.id;
  online.set(k, ws);
  const peer = peerOf(link, user, chat);
  send(ws, { t: 'welcome', mode: 'session', link: { id: link.id, peer }, peerOnline: online.has(key(peer.user, peer.chat)) });
  notifyPresence(link, user, chat);
  audit({ ev: 'online', user, chat, linkId: link.id });
}

function handle(ws, m) {
  if (ws.mode === 'admin') return handleAdmin(ws, m);
  if (ws.mode === 'session') return handleSession(ws, m);
}

function handleAdmin(ws, m) {
  const user = ws.user;
  switch (m.t) {
    case 'pair_create': {
      const chat = String(m.chat || '');
      if (!NAME_RE.test(chat)) return send(ws, { t: 'error', code: 'bad_chat', message: 'invalid chat label' });
      if (findLink(user, chat)) return send(ws, { t: 'error', code: 'already_linked', message: `chat "${chat}" is already linked` });
      const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
      pending.set(code, { user, chat, ws, exp: Date.now() + PAIR_TTL_MS });
      audit({ ev: 'pair_create', user, chat });
      return send(ws, { t: 'pair_code', code, expiresInSec: PAIR_TTL_MS / 1000 });
    }
    case 'pair_accept': {
      const chat = String(m.chat || ''); const code = String(m.code || '').toUpperCase();
      if (!NAME_RE.test(chat)) return send(ws, { t: 'error', code: 'bad_chat', message: 'invalid chat label' });
      const p = pending.get(code);
      if (!p || p.exp < Date.now()) { pending.delete(code); return send(ws, { t: 'error', code: 'bad_code', message: 'unknown or expired code' }); }
      if (p.user === user) return send(ws, { t: 'error', code: 'same_user', message: 'cannot pair with yourself' });
      if (findLink(user, chat)) return send(ws, { t: 'error', code: 'already_linked', message: `chat "${chat}" is already linked` });
      if (p.requester) return send(ws, { t: 'error', code: 'busy', message: 'code already in use' });
      p.requester = { user, chat, ws };
      send(p.ws, { t: 'pair_request', code, from: { user, chat } }); // creator's human must approve
      send(ws, { t: 'pair_waiting', message: `waiting for ${p.user} to approve` });
      audit({ ev: 'pair_request', from: user, fromChat: chat, to: p.user, toChat: p.chat });
      return;
    }
    case 'pair_decision': {
      const code = String(m.code || '').toUpperCase();
      const p = pending.get(code);
      if (!p || p.ws !== ws || !p.requester) return;
      pending.delete(code);
      if (!m.ok) { send(p.requester.ws, { t: 'pair_denied' }); send(ws, { t: 'pair_denied' }); audit({ ev: 'pair_denied', user: p.user }); return; }
      const link = { id: crypto.randomUUID(), a: { user: p.user, chat: p.chat }, b: { user: p.requester.user, chat: p.requester.chat }, createdAt: new Date().toISOString() };
      links.push(link); writeJson(linksFile, links);
      audit({ ev: 'paired', linkId: link.id, a: link.a, b: link.b });
      send(p.ws, { t: 'paired', link, peer: link.b });
      send(p.requester.ws, { t: 'paired', link, peer: link.a });
      return;
    }
    case 'list_links': {
      return send(ws, { t: 'links', links: links.filter(l => l.a.user === user || l.b.user === user) });
    }
    case 'unlink': {
      const chat = String(m.chat || '');
      const link = findLink(user, chat);
      if (!link) return send(ws, { t: 'error', code: 'not_linked', message: 'no such link' });
      links = links.filter(l => l.id !== link.id); writeJson(linksFile, links);
      for (const side of [link.a, link.b]) {
        const w = online.get(key(side.user, side.chat));
        if (w) { send(w, { t: 'unlinked' }); w.close(4007, 'unlinked'); }
      }
      audit({ ev: 'unlinked', linkId: link.id, by: user });
      return send(ws, { t: 'unlinked_ok', chat });
    }
  }
}

function handleSession(ws, m) {
  if (m.t === 'ping') return send(ws, { t: 'pong' });
  if (m.t !== 'msg') return;
  const link = findLink(ws.user, ws.chat);
  if (!link) return send(ws, { t: 'ack', id: m.id, delivered: false, reason: 'not_linked' });
  const text = m.parts && m.parts[0] && m.parts[0].kind === 'text' ? String(m.parts[0].text) : '';
  if (!text) return send(ws, { t: 'ack', id: m.id, delivered: false, reason: 'empty_or_non_text' });
  if (text.length > MAX_TEXT) return send(ws, { t: 'ack', id: m.id, delivered: false, reason: `too_long (max ${MAX_TEXT} chars)` });
  if (!rateOk(link.id)) { audit({ ev: 'rate_limited', user: ws.user, linkId: link.id }); return send(ws, { t: 'ack', id: m.id, delivered: false, reason: 'rate_limited' }); }
  const peer = peerOf(link, ws.user, ws.chat);
  const pw = online.get(key(peer.user, peer.chat));
  if (!pw) { audit({ ev: 'undelivered_offline', from: ws.user, to: peer.user, linkId: link.id }); return send(ws, { t: 'ack', id: m.id, delivered: false, reason: 'peer_offline' }); }
  const out = { t: 'msg', id: m.id, from: ws.user, fromChat: ws.chat, contextId: String(m.contextId || m.id), parts: [{ kind: 'text', text }] };
  send(pw, out);
  audit({ ev: 'msg', linkId: link.id, from: ws.user, to: peer.user, id: m.id, contextId: out.contextId, text });
  send(ws, { t: 'ack', id: m.id, delivered: true });
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  for (const [code, p] of pending) if (p.exp < Date.now()) pending.delete(code);
}, 15000).unref();

wss.on('listening', () => console.log(`claude-link relay listening on ws://${HOST}:${PORT}  data=${DATA}`));
