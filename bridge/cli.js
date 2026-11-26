#!/usr/bin/env node
// slopstream CLI: setup, pairing (human-approved on BOTH sides), links, unlink, init.
// Deliberately NOT available to the agent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { loadConfig, saveConfig, configFile, codexThreadFile, pausedFile, defaultHome } from './config.js';
import { admin, nextMsg, normCode } from './net.js';
import { runInit } from './init.js';
import { runStatus } from './status.js';
import { runSimulate } from './simulate.js';
import { demoUp, demoStatus, demoPeer, demoDown } from './demo.js';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
const optVals = new Set(['agent', 'chat', 'home', 'a', 'b', 'c', 'port', 'dir', 'side', 'linger', 'to', 'relay-data'].map(n => args.indexOf(`--${n}`)).filter(i => i >= 0).map(i => i + 1));
const pos = args.filter((a, i) => !a.startsWith('--') && !optVals.has(i));
const [cmd, ...rest] = pos;
const die = (m) => { console.error(m); process.exit(1); };

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a); }); });
const needCfg = () => loadConfig() || die('Not set up. Run: slopstream setup <relay-url> <your-user> <your-token>');

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
    case 'pair-create':
    case 'invite': {
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
      console.log(`slopstream: seamless slop grenades. Safety pin included.

usage: slopstream <command>
  setup <relay-url> <user> <token>   save credentials (once per machine)
  pair-create <chat> [--yes]         make a pairing code for a chat, wait for friend, approve
  pair-accept <code> <chat>          accept a friend's code for one of your chats
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
  demo up|status|peer|down           test everything on THIS laptop alone (see TESTING.md)
  simulate --chat <chat> [--agent]   stand-in agent with no AI, for testing the plumbing`);
  }
}
main().then(() => process.exit(process.exitCode || 0)).catch((e) => die(`error: ${e.message}`));
