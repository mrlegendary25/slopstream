#!/usr/bin/env node
// slopstream CLI: setup, pairing (human-approved on BOTH sides), links, unlink, init.
// Deliberately NOT available to the agent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { loadConfig, saveConfig, configFile, DEFAULT_RELAY, codexThreadFile, pausedFile, defaultHome } from './config.js';
import { admin, nextMsg, normCode } from './net.js';
import { runInit } from './init.js';
import { maybeNotifyUpdate } from './update-check.js';
import { RelayError, explain } from './errors.js';
import { runLogin } from './login.js';
import { httpBase, getJson } from './http.js';
import { runStatus } from './status.js';
import { runSimulate } from './simulate.js';
import { demoUp, demoStatus, demoPeer, demoDown } from './demo.js';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
const optVals = new Set(['relay', 'agent', 'chat', 'home', 'a', 'b', 'c', 'port', 'dir', 'side', 'linger', 'to', 'relay-data'].map(n => args.indexOf(`--${n}`)).filter(i => i >= 0).map(i => i + 1));
const pos = args.filter((a, i) => !a.startsWith('--') && !optVals.has(i));
const [cmd, ...rest] = pos;
const die = (m) => { console.error(m); process.exit(1); };

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a); }); });

// Stops a prompt-injected agent from linking chats on its own: an agent's shell tool has no TTY, a person's terminal does.
function requireHuman(action) {
  if (process.stdin.isTTY && process.stdout.isTTY) return;
  if (process.env.SLOPSTREAM_ALLOW_NONINTERACTIVE === '1') return; // tests only
  die(`"slopstream ${action}" must be typed by a person in a terminal, not run by an agent or a script.`);
}

// Folder name -> a valid chat label.
function defaultChat(cwd) {
  return path.basename(cwd).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'chat';
}

// Wire this folder up and say what to do next. Called BEFORE waiting, so the folder is ready even if the terminal closes.
function initFolder(chat) {
  const r = runInit({ chat, agent: opt('agent') || 'claude', cwd: process.cwd(), home: opt('home') });
  console.log(`Set up ${r.agent} in ${process.cwd()}: wrote ${r.written.join(' and ')}`);
  for (const w of r.warnings || []) console.log(`WARNING: ${w}`);
  return r;
}
function printStart(r) {
  if (r && r.agent !== 'claude') console.log(r.next.join('\n'));
  else console.log('Start the linked session with:\n  claude --dangerously-load-development-channels server:slopstream');
}
const peersOf = (members) => members.map(p => `${p.user}/${p.chat}`).join(', ');
const who = (u) => `@${u.user}${u.github ? ` (github.com/${u.github})` : ''}`;

async function ensureLoggedIn(relay) {
  return loadConfig() || await runLogin({ relay });
}

const needCfg = () => loadConfig() || die('Not set up. Run: slopstream login');

// The relay writes a pidfile on start (relay/server.js). That is the primary lookup and works on
// every OS. `pgrep` stays as a Unix-only fallback so a relay started before pidfiles existed, or
// wrapped in `caffeinate ... node relay/server.js`, is still found.
function relayPidFiles(relayData) {
  const files = [path.join(os.homedir(), '.slopstream-relay.pid')];
  if (relayData) files.unshift(path.join(relayData, 'relay.pid'));
  if (process.env.DATA_DIR) files.push(path.join(path.resolve(process.env.DATA_DIR), 'relay.pid'));
  return files;
}

function readPidFile(f) {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(f, 'utf8')).pid);
    if (!pid || pid === process.pid) return 0;
    process.kill(pid, 0); // throws if the process is gone, i.e. a stale pidfile
    return pid;
  } catch { return 0; }
}

function findRelayPids(relayData) {
  const pids = new Set();
  for (const f of relayPidFiles(relayData)) { const pid = readPidFile(f); if (pid) pids.add(pid); }
  if (process.platform !== 'win32') {
    try {
      execSync("pgrep -f 'relay/server\\.js'", { encoding: 'utf8' })
        .split('\n').map((s) => Number(s.trim()))
        .filter((pid) => pid && pid !== process.pid)
        .forEach((pid) => pids.add(pid));
    } catch { /* pgrep exits non-zero when nothing matches */ }
  }
  return [...pids];
}

async function stopRunningRelays(relayData) {
  const pids = findRelayPids(relayData);
  if (!pids.length) { console.log('No running relay process found on this machine.'); return; }
  console.log(`Stopping running relay process(es): ${pids.join(', ')}`);
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  await new Promise((r) => setTimeout(r, 1500));
  for (const pid of findRelayPids(relayData)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

function wipeEverything({ home, relayData }) {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(relayData, { recursive: true, force: true });
  console.log('Done. Everything reset to zero.\nStart fresh with: node relay/admin.js add-user <name>, then slopstream setup ...');
}

async function main() {
  switch (cmd) {
    case 'setup': {
      const [relay, user, token] = rest;
      if (!relay || !user || !token) die('usage: slopstream setup <relay-url e.g. wss://host or ws://127.0.0.1:8787> <user> <token>');
      const cfg = { relay, user, token };
      const ws = await admin(cfg); ws.close();
      saveConfig(cfg);
      console.log(`OK. Authenticated as "${user}". Saved to ${configFile()}`);
      break;
    }
    case 'link': {
      requireHuman('link');
      const cfg = await ensureLoggedIn(DEFAULT_RELAY);
      const chat = rest[0] || defaultChat(process.cwd());
      console.log(`Chat label: ${chat}`);
      const ws = await admin(cfg);
      ws.send(JSON.stringify({ t: 'list_links' }));
      const { links } = await nextMsg(ws, ['links'], 5000);
      const mineLink = links.find(l => l.members.some(m => m.user === cfg.user && m.chat === chat));
      const add = args.includes('--add');
      if (mineLink && !add) {
        const peers = peersOf(mineLink.members.filter(m => !(m.user === cfg.user && m.chat === chat)));
        die(`"${chat}" is already linked with ${peers}. To add another person to that group, run: slopstream link --add`);
      }
      const init = args.includes('--no-init') ? null : initFolder(chat);
      ws.send(JSON.stringify({ t: add ? 'invite_create' : 'pair_create', chat }));
      const c = await nextMsg(ws, ['pair_code']);
      const mine = (m) => normCode(m.code) === normCode(c.code);
      const until = new Date(Date.now() + c.expiresInSec * 1000).toLocaleString();
      console.log(`\nSend this to your teammate:\n\n  Link our agents: ${c.url || c.code}\n\n(valid for ${Math.round(c.expiresInSec / 3600)} hours, works once). Waiting for them to join... (Ctrl+C is fine; approve later with: slopstream requests)`);
      const stays = () => { console.log(`\nThe invite stays valid until ${until}. When someone uses it, approve with: slopstream requests`); process.exit(0); };
      process.on('SIGINT', stays); ws.on('close', stays);
      const req = await nextMsg(ws, ['pair_request'], 0, mine);
      console.log(`\n${who(req.from)} wants to link their chat "${req.from.chat}" with your chat "${chat}".`);
      const ok = yes || /^y(es)?$/i.test((await ask('Approve? [y/N] ')).trim());
      ws.send(JSON.stringify({ t: 'pair_decision', code: req.code, ok }));
      const r = await nextMsg(ws, ['paired', 'pair_denied'], 0, mine);
      ws.off('close', stays); process.off('SIGINT', stays);
      if (r.t === 'paired') { console.log(`Linked! ${chat} <-> ${peersOf(r.members)}`); printStart(init); } else console.log('Denied.');
      ws.close(); break;
    }
    case 'join': {
      requireHuman('join');
      const input = rest[0]; if (!input) die('usage: slopstream join <code-or-link> [chat-label]');
      let relayFromUrl = null; let code;
      if (/^https?:\/\//.test(input)) {
        const u = new URL(input);
        relayFromUrl = (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host;
        code = normCode(u.pathname.split('/j/')[1] || '');
      } else code = normCode(input);
      if (!code) die('That does not look like an invite code or link.');
      let cfg = loadConfig();
      if (cfg && relayFromUrl && httpBase(cfg.relay) !== httpBase(relayFromUrl)) {
        die(`This invite is for ${relayFromUrl} but you're logged in to ${cfg.relay}. Run: slopstream logout, then try again.`);
      }
      cfg = cfg || await runLogin({ relay: relayFromUrl || DEFAULT_RELAY });
      const inv = await getJson(`${httpBase(cfg.relay)}/v1/invite/${code}`);
      if (inv.status === 'used') die(explain('bad_code', 'That invite was already used.'));
      if (inv.status !== 'open') die(explain('bad_code', 'That invite is unknown or has expired.'));
      const chat = rest[1] || defaultChat(process.cwd());
      console.log(`Link this folder (chat "${chat}") with @${inv.inviter}'s chat "${inv.chat}"?\nTheir agent will be able to send messages here; you approve each one.`);
      if (!yes && !/^y(es)?$/i.test((await ask('[y/N] ')).trim())) die('Cancelled.');
      const init = args.includes('--no-init') ? null : initFolder(chat);
      const ws = await admin(cfg);
      ws.send(JSON.stringify({ t: 'pair_accept', code, chat }));
      await nextMsg(ws, ['pair_waiting'], 5000);
      console.log(`Waiting for @${inv.inviter} to approve... (you can close this; check later with: slopstream links)`);
      const r = await nextMsg(ws, ['paired', 'pair_denied'], 0, (m) => normCode(m.code) === code);
      if (r.t === 'paired') { console.log(`Linked! ${chat} <-> ${peersOf(r.members)}`); printStart(init); } else console.log('Denied by the other side.');
      ws.close(); break;
    }
    case 'login': {
      await runLogin({ relay: opt('relay') });
      break;
    }
    case 'whoami': {
      const cfg = needCfg();
      console.log(`${cfg.user} on ${cfg.relay}`);
      try { (await admin(cfg)).close(); console.log('✓ login works'); }
      catch (e) { console.error(`✗ ${e instanceof RelayError ? explain(e.code, e.message) : e.message}`); process.exit(1); }
      break;
    }
    case 'devices': {
      const cfg = needCfg(); const ws = await admin(cfg);
      if (rest[0] === 'revoke') {
        if (!rest[1]) die('usage: slopstream devices revoke <id-prefix>');
        ws.send(JSON.stringify({ t: 'device_list' }));
        const { devices } = await nextMsg(ws, ['devices'], 5000);
        const hits = devices.filter(d => d.id.startsWith(rest[1]));
        if (hits.length !== 1) die(hits.length ? 'that prefix matches more than one device; use more characters' : 'no device with that id');
        ws.send(JSON.stringify({ t: 'device_revoke', id: hits[0].id }));
        await nextMsg(ws, ['device_revoked'], 5000);
        console.log(`Revoked ${hits[0].label} (${hits[0].id.slice(0, 8)}).`);
      } else {
        ws.send(JSON.stringify({ t: 'device_list' }));
        const { devices } = await nextMsg(ws, ['devices'], 5000);
        if (!devices.length) console.log('(no devices; this login uses a legacy token)');
        for (const d of devices) console.log(`${d.id.slice(0, 8)}  ${d.label.padEnd(30)}  last seen ${new Date(d.lastSeenAt).toLocaleString()}${d.current ? '  (this device)' : ''}`);
      }
      ws.close(); break;
    }
    case 'logout': {
      const cfg = loadConfig();
      if (cfg && cfg.auth === 'github' && cfg.deviceId) {
        try { const ws = await admin(cfg); ws.send(JSON.stringify({ t: 'device_revoke', id: cfg.deviceId })); await nextMsg(ws, ['device_revoked'], 3000).catch(() => {}); ws.close(); } catch { /* relay unreachable: still log out locally */ }
      }
      fs.rmSync(configFile(), { force: true });
      console.log('Logged out.');
      break;
    }
    case 'pair-create':
    case 'invite': {
      requireHuman(cmd);
      // pair-create makes a NEW link; invite adds a person to a chat that is ALREADY linked (up to the relay's group limit).
      const isInvite = cmd === 'invite';
      const chat = rest[0];
      if (!chat) die(isInvite ? 'usage: slopstream invite <chat-label> [--yes]   (that chat must already be linked)' : 'usage: slopstream pair-create <chat-label> [--yes]');
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: isInvite ? 'invite_create' : 'pair_create', chat }));
      const c = await nextMsg(ws, ['pair_code']);
      const mine = (m) => normCode(m.code) === normCode(c.code);
      const until = new Date(Date.now() + c.expiresInSec * 1000).toLocaleString();
      console.log(`\n${isInvite ? 'Invite' : 'Pairing'} code for chat "${chat}":  ${c.code}   (valid until ${until})`);
      if (c.url) console.log(`Link to send:  ${c.url}`);
      console.log(`They run:  slopstream pair-accept ${c.code} <their-chat-label>\nWaiting...`);
      const stays = () => { console.log(`\nThe invite stays valid until ${until}. When someone uses it, approve with: slopstream requests`); process.exit(0); };
      process.on('SIGINT', stays);
      ws.on('close', stays);
      const req = await nextMsg(ws, ['pair_request'], 0, mine);
      console.log(`\n${req.from.user}${req.from.github ? ` (github.com/${req.from.github})` : ''} wants to ${isInvite ? `join "${chat}"` : `link their chat "${req.from.chat}" to your chat "${chat}"`}${isInvite ? ` (their chat label: "${req.from.chat}")` : ''}.`);
      const ok = yes || /^y(es)?$/i.test((await ask('Approve? [y/N] ')).trim());
      ws.send(JSON.stringify({ t: 'pair_decision', code: req.code, ok }));
      const r = await nextMsg(ws, ['paired', 'pair_denied'], 0, mine);
      console.log(r.t === 'paired' ? `Linked: ${chat} <-> ${r.members.map(p => `${p.user}/${p.chat}`).join(', ')}` : 'Denied.');
      ws.off('close', stays); process.off('SIGINT', stays);
      ws.close(); break;
    }
    case 'pair-accept': {
      requireHuman(cmd);
      const [code, chat] = rest; if (!code || !chat) die('usage: slopstream pair-accept <code> <chat-label>');
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'pair_accept', code, chat }));
      const w = await nextMsg(ws, ['pair_waiting']);
      console.log(`${w.message.charAt(0).toUpperCase()}${w.message.slice(1)}. You can close this; once approved the link appears in: slopstream links`);
      const r = await nextMsg(ws, ['paired', 'pair_denied'], 0, (m) => normCode(m.code) === normCode(code));
      console.log(r.t === 'paired' ? `Linked: ${chat} <-> ${r.members.map(p => `${p.user}/${p.chat}`).join(', ')}` : 'Denied by the other side.');
      ws.close(); break;
    }
    case 'requests': {
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'list_requests' }));
      const { invites } = await nextMsg(ws, ['requests'], 5000);
      if (!invites.length) console.log('No open invites.');
      for (const v of invites) {
        const r = v.requester;
        console.log(`${v.code}  ${v.kind}  chat "${v.chat}"  expires ${new Date(v.expiresAt).toLocaleString()}  ` +
          (r ? `REQUEST from ${r.user}${r.github ? ` (github.com/${r.github})` : ''} (chat "${r.chat}")  -> slopstream approve ${v.code}` : 'unused'));
      }
      ws.close(); break;
    }
    case 'approve':
    case 'deny': {
      if (cmd === 'approve') requireHuman(cmd);
      const code = rest[0]; if (!code) die(`usage: slopstream ${cmd} <code>${cmd === 'approve' ? ' [--yes]' : ''}`);
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'list_requests' }));
      const { invites } = await nextMsg(ws, ['requests'], 5000);
      const v = invites.find(x => normCode(x.code) === normCode(code));
      if (!v || !v.requester) die(v ? `Nobody has used invite ${v.code} yet.` : `No open invite ${code}.`);
      let ok = false;
      if (cmd === 'approve') {
        const r = v.requester;
        console.log(`${r.user}${r.github ? ` (github.com/${r.github})` : ''} wants to link their chat "${r.chat}" with your chat "${v.chat}".`);
        ok = yes || /^y(es)?$/i.test((await ask('Approve? [y/N] ')).trim());
      }
      const mine = (m) => normCode(m.code) === normCode(v.code);
      const done = nextMsg(ws, ['paired', 'pair_denied'], 5000, mine);
      ws.send(JSON.stringify({ t: 'pair_decision', code: v.code, ok }));
      const r = await done;
      console.log(r.t === 'paired' ? `Linked: ${v.chat} <-> ${r.members.map(p => `${p.user}/${p.chat}`).join(', ')}` : 'Denied.');
      ws.close(); break;
    }
    case 'cancel': {
      const code = rest[0]; if (!code) die('usage: slopstream cancel <code>');
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'invite_cancel', code }));
      const r = await nextMsg(ws, ['invite_cancelled'], 5000);
      console.log(`Cancelled invite ${r.code}.`);
      ws.close(); break;
    }
    case 'links': {
      const cfg = needCfg(); const ws = await admin(cfg);
      ws.send(JSON.stringify({ t: 'list_links' }));
      const r = await nextMsg(ws, ['links']);
      if (!r.links.length) console.log('(no links)');
      for (const l of r.links) {
        const mine = l.members.find(m => m.user === cfg.user);
        const others = l.members.filter(m => m !== mine);
        const peers = others.map(o => `${o.user}/${o.chat}${o.online ? ' (online)' : ''}`).join(', ');
        console.log(`${mine.chat}  <->  ${peers}   (since ${l.createdAt})`);
      }
      ws.close(); break;
    }
    case 'unlink': {
      const chat = rest[0]; if (!chat) die('usage: slopstream unlink <chat-label>');
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'unlink', chat }));
      await nextMsg(ws, ['unlinked_ok']); console.log(`Unlinked "${chat}".`); ws.close(); break;
    }
    case 'pause': {
      // Local-only: makes the bridge refuse to connect to the relay for this chat, so nobody can reach it,
      // without touching the link itself. Takes effect the next time a session for this chat starts.
      const chat = rest[0]; if (!chat) die('usage: slopstream pause <chat-label>');
      const f = pausedFile(chat); fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      fs.writeFileSync(f, JSON.stringify({ pausedAt: new Date().toISOString() }), { mode: 0o600 });
      console.log(`Paused "${chat}". Restart any Claude/Codex session using it for this to take effect.\nNobody can reach it until you run: slopstream resume ${chat}`);
      break;
    }
    case 'resume': {
      const chat = rest[0]; if (!chat) die('usage: slopstream resume <chat-label>');
      fs.rmSync(pausedFile(chat), { force: true });
      console.log(`Resumed "${chat}". Restart any Claude/Codex session using it to reconnect.`);
      break;
    }
    case 'init': {
      const chat = rest[0]; if (!chat) die('usage: slopstream init <chat-label> [--agent claude|codex]   (run inside the project folder)');
      const r = runInit({ chat, agent: opt('agent') || 'claude', cwd: process.cwd(), home: opt('home') });
      console.log(`Set up ${r.agent} in ${process.cwd()}: wrote ${r.written.join(' and ')}`);
      for (const w of r.warnings || []) console.log(`WARNING: ${w}`);
      if (r.agent === 'claude') console.log('Start the linked session with:\n  claude --dangerously-load-development-channels server:slopstream');
      else console.log(r.next.join('\n'));
      break;
    }
    case 'codex-hook': {
      // Called BY CODEX (SessionStart hook), never by a person. Records which Codex chat this folder is.
      // Must never fail loudly or print anything: a broken hook should not disturb the chat.
      try {
        const chat = opt('chat'); const home = opt('home');
        let raw = ''; for await (const c of process.stdin) raw += c;
        const j = JSON.parse(raw);
        const id = String(j.session_id || j.thread_id || '');
        if (chat && /^[0-9a-zA-Z-]{8,64}$/.test(id)) {
          const f = codexThreadFile(chat, home || undefined);
          fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
          fs.writeFileSync(f, JSON.stringify({ thread: id, ts: Date.now() }), { mode: 0o600 });
        }
      } catch { /* silent */ }
      break;
    }
    case 'force-clean':
    case 'force-stop-clean': {
      // Nukes everything back to zero: this machine's saved login/pauses/logs, AND the relay's
      // users/links/audit log. Does NOT touch the npm link (the `slopstream` command stays installed).
      // force-stop-clean additionally finds and kills any running relay/server.js process first.
      const stopFirst = cmd === 'force-stop-clean';
      const home = opt('home') ? path.resolve(opt('home')) : defaultHome();
      const relayData = opt('relay-data')
        ? path.resolve(opt('relay-data'))
        : (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(os.homedir(), '.slopstream-relay'));
      console.log(`This will PERMANENTLY delete:
  - this machine's saved login, pauses and logs:  ${home}
  - the relay's data (ALL users, ALL links, audit log):  ${relayData}

The "slopstream" command itself (the npm link) is NOT removed.`);
      console.log(stopFirst
        ? 'Any running relay process on this machine will be stopped first.'
        : "If the relay is running, stop it first (Ctrl+C) -- deleting its data while it's running can corrupt it.\n(Or run slopstream force-stop-clean to have this done for you.)");
      const ok = yes || /^yes$/i.test((await ask('Type "yes" to continue: ')).trim());
      if (!ok) { console.log('Aborted. Nothing was deleted.'); break; }
      if (stopFirst) await stopRunningRelays(relayData);
      wipeEverything({ home, relayData });
      break;
    }
    case 'status': process.exitCode = await runStatus(); break;
    case 'simulate': {
      const chat = opt('chat'); if (!chat) die('usage: slopstream simulate --chat <chat-label> [--agent claude|codex]');
      if (opt('home')) process.env.SLOPSTREAM_HOME = path.resolve(opt('home'));
      await runSimulate({ chat, agent: opt('agent') || 'claude', linger: opt('linger') !== undefined ? Number(opt('linger')) : undefined });
      return new Promise(() => {}); // runSimulate exits the process itself
    }
    case 'demo': {
      const sub = rest[0];
      if (sub === 'up') await demoUp({ dir: opt('dir'), a: opt('a') || 'claude', b: opt('b') || 'claude', c: opt('c'), port: opt('port') ? Number(opt('port')) : 18787 });
      else if (sub === 'status') process.exitCode = await demoStatus();
      else if (sub === 'down') demoDown();
      else if (sub === 'peer') { await demoPeer({ side: opt('side'), agent: opt('agent'), linger: opt('linger') !== undefined ? Number(opt('linger')) : undefined }); return new Promise(() => {}); }
      else die('usage: slopstream demo up [--a claude|codex] [--b claude|codex] [--c claude|codex] [--port N]\n       slopstream demo status | down\n       slopstream demo peer --side a|b|c');
      break;
    }
    default:
      console.log(`slopstream: your agent can ask mine.

usage: slopstream <command>
  link [chat] [--agent claude|codex] [--add]   make an invite link for this folder and wait for your teammate
  join <code-or-link> [chat]         link this folder to a teammate's invite
  login [--relay <url>]              log in with GitHub (once per machine)
  whoami                             show who you are logged in as and check it works
  devices [revoke <id>]              list (or revoke) the devices logged in as you
  logout                             revoke this device and forget the login
  setup <relay-url> <user> <token>   save credentials of a self-hosted relay (once per machine)
  pair-create <chat> [--yes]         make a pairing code for a chat, wait for teammate, approve
  pair-accept <code> <chat>          accept a teammate's code for one of your chats
  invite <chat> [--yes]              add another person to a chat that is ALREADY linked (up to the relay's group limit)
  requests                           list your open invites and who has used them
  approve <code> [--yes]             approve someone who used your invite (also works later, after you closed pair-create)
  deny <code>                        refuse such a request
  cancel <code>                      cancel an open invite
  links                              list your links (and who else is in each group)
  unlink <chat>                      leave a link; dissolves it if fewer than 2 chats would remain
  pause <chat>                       stop a chat connecting to the relay, without unlinking it
  resume <chat>                      undo pause
  force-clean [--yes] [--relay-data <dir>] [--home <dir>]
                                      DANGER: wipe this machine's login/pauses/logs AND the relay's
                                      users/links/audit log back to zero. Keeps the npm link.
  force-stop-clean [--yes] [--relay-data <dir>] [--home <dir>]
                                      same as force-clean, but first finds and kills any running
                                      relay/server.js process on this machine.
  init <chat> [--agent claude|codex]  (in a project folder) wire this folder up for Claude Code or Codex
  status                             is this machine ready? who is online?
  demo up|status|peer|down           test everything on THIS machine alone (see docs/testing.md)
  simulate --chat <chat> [--agent]   stand-in agent with no AI, for testing the plumbing`);
  }
}
const quiet = cmd === 'codex-hook' || cmd === 'simulate' || (cmd === 'demo' && rest[0] === 'peer');
main().then(() => (quiet ? null : maybeNotifyUpdate())).then(() => process.exit(process.exitCode || 0)).catch((e) => die(e instanceof RelayError ? explain(e.code, e.message) : `error: ${e.message}`));
