#!/usr/bin/env node
// slopstream CLI: setup, pairing (human-approved on BOTH sides), links, unlink, init.
// Deliberately NOT available to the agent.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig, saveConfig, deleteSecret, configFile, DEFAULT_RELAY, codexThreadFile, pausedFile, defaultHome } from './config.js';
import { admin, nextMsg, normCode } from './net.js';
import { runInit } from './init.js';
import { maybeNotifyUpdate } from './update-check.js';
import { RelayError, explain } from './errors.js';
import { detectAgents, chooseAgent, describeChoice } from './agents.js';
import { runLogin, openBrowser } from './login.js';
import { httpBase, getJson } from './http.js';
import { runDoctor } from './doctor.js';
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
// Which agent this folder is for: --agent, else what's installed and what the folder already has (bridge/agents.js).
async function pickAgent() {
  const choice = await chooseAgent({ flag: opt('agent'), detected: detectAgents({ cwd: process.cwd() }), isTTY: !!(process.stdin.isTTY && process.stdout.isTTY), ask });
  if (!opt('agent')) console.log(describeChoice(choice));
  for (const w of choice.warnings) console.log(`WARNING: ${w}`);
  return choice.agent;
}

async function initFolder(chat) {
  const r = runInit({ chat, agent: await pickAgent(), cwd: process.cwd(), home: opt('home') });
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
  return loadHuman() || await runLogin({ relay });
}

// Does this relay want a click in the browser (signed in to GitHub) before a chat becomes reachable by someone new?
// Then the browser page IS the approval, so the terminal y/N is skipped. An old relay has no such flag: the terminal flow stays.
async function browserConfirms(cfg) {
  if (cfg.auth !== 'github') return false;
  try { return (await getJson(`${httpBase(cfg.relay)}/v1/info`)).confirmLinks === true; } catch { return false; }
}

// Like nextMsg, but if the relay parks the request until the person confirms in the browser, show the link and keep waiting.
// `retryHint` says what to run when the confirmation expires before anyone clicked.
async function waitConfirming(ws, cfg, types, mine, retryHint, firstTimeout = 0) {
  let timeout = firstTimeout;
  for (;;) {
    const m = await nextMsg(ws, [...types, 'confirm_required', 'confirm_expired', 'confirm_declined'], timeout, mine);
    if (m.t === 'confirm_required') {
      console.log(`\nApprove in your browser: ${m.url}   (link expires in ${Math.max(1, Math.round(m.expiresInSec / 60))} minutes)`);
      openBrowser(m.url, { allowOrigin: httpBase(cfg.relay) });
      timeout = 0; continue;
    }
    if (m.t === 'confirm_expired') die(`The confirmation expired. Nothing was linked.\n  → ${retryHint}`);
    if (m.t === 'confirm_declined') die('You declined in the browser. Nothing was linked.');
    return m;
  }
}

const loadHuman = () => loadConfig(defaultHome(), { migrate: true }); // human commands only: moves an old plain-file token into the keychain
const needCfg = () => loadHuman() || die('Not set up. Run: slopstream login');

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
      // `link @alice [chat]`: an invite only @alice can use. Otherwise `link [chat]` makes a link anyone you send it to can use.
      const target = rest[0]?.startsWith('@') ? rest[0].slice(1) : null;
      const chat = (target ? rest[1] : rest[0]) || defaultChat(process.cwd());
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
      const init = args.includes('--no-init') ? null : await initFolder(chat);
      ws.send(JSON.stringify({ t: add ? 'invite_create' : 'pair_create', chat, ...(target ? { for: target } : {}) }));
      const c = await nextMsg(ws, ['pair_code']);
      const mine = (m) => normCode(m.code) === normCode(c.code);
      const until = new Date(Date.now() + c.expiresInSec * 1000).toLocaleString();
      console.log(`\nSend this to ${target ? `@${target}` : 'your teammate'}:\n\n  Link our agents: ${c.url || c.code}\n\n(valid for ${Math.round(c.expiresInSec / 3600)} hours, works once${target ? `, and only @${target} can use it` : ''}). Waiting for them to join... (Ctrl+C is fine; approve later with: slopstream requests)`);
      if (target) console.log(`If @${target} uses slopstream on this relay, they'll also see it in: slopstream requests`);
      const stays = () => { console.log(`\nThe invite stays valid until ${until}. When someone uses it, approve with: slopstream requests`); process.exit(0); };
      process.on('SIGINT', stays); ws.on('close', stays);
      const viaBrowser = await browserConfirms(cfg);
      const req = await nextMsg(ws, ['pair_request'], 0, mine);
      console.log(`\n${who(req.from)} wants to link their chat "${req.from.chat}" with your chat "${chat}".`);
      const ok = viaBrowser || yes || /^y(es)?$/i.test((await ask('Approve? [y/N] ')).trim());
      ws.send(JSON.stringify({ t: 'pair_decision', code: req.code, ok }));
      const r = await waitConfirming(ws, cfg, ['paired', 'pair_denied'], mine, `Run: slopstream approve ${req.code}`);
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
      let cfg = loadHuman();
      if (cfg && relayFromUrl && httpBase(cfg.relay) !== httpBase(relayFromUrl)) {
        die(`This invite is for ${relayFromUrl} but you're logged in to ${cfg.relay}. Run: slopstream logout, then try again.`);
      }
      cfg = cfg || await runLogin({ relay: relayFromUrl || DEFAULT_RELAY });
      const inv = await getJson(`${httpBase(cfg.relay)}/v1/invite/${code}`);
      if (inv.status === 'used') die(explain('bad_code', 'That invite was already used.'));
      if (inv.status !== 'open') die(explain('bad_code', 'That invite is unknown or has expired.'));
      const chat = rest[1] || defaultChat(process.cwd());
      console.log(`Link this folder (chat "${chat}") with @${inv.inviter}'s chat "${inv.chat}"?\nTheir agent will be able to send messages here; you approve each one.`);
      const viaBrowser = await browserConfirms(cfg);
      if (!viaBrowser && !yes && !/^y(es)?$/i.test((await ask('[y/N] ')).trim())) die('Cancelled.');
      const init = args.includes('--no-init') ? null : await initFolder(chat);
      const ws = await admin(cfg);
      ws.send(JSON.stringify({ t: 'pair_accept', code, chat }));
      await waitConfirming(ws, cfg, ['pair_waiting'], (m) => normCode(m.code) === code, 'Run the same command again: slopstream join ' + input, 8000);
      console.log(`Waiting for @${inv.inviter} to approve... (you can close this; check later with: slopstream links)`);
      const r = await nextMsg(ws, ['paired', 'pair_denied'], 0, (m) => normCode(m.code) === code);
      if (r.t === 'paired') { console.log(`Linked! ${chat} <-> ${peersOf(r.members)}`); printStart(init); } else console.log('Denied by the other side.');
      ws.close(); break;
    }
    case 'login': {
      await runLogin({ relay: opt('relay') });
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
      if (cfg && cfg.auth === 'github' && cfg.deviceId && cfg.token) {
        try { const ws = await admin(cfg); ws.send(JSON.stringify({ t: 'device_revoke', id: cfg.deviceId })); await nextMsg(ws, ['device_revoked'], 3000).catch(() => {}); ws.close(); } catch { /* relay unreachable: still log out locally */ }
      }
      deleteSecret(cfg);
      fs.rmSync(configFile(), { force: true });
      console.log('Logged out.');
      break;
    }
    case 'requests': {
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'list_requests' }));
      const { invites, incoming = [] } = await nextMsg(ws, ['requests'], 5000);
      if (incoming.length) {
        console.log('Invites for you:');
        for (const v of incoming) console.log(`  ${v.code}  from @${v.from.user}${v.from.github ? ` (github.com/${v.from.github})` : ''}, chat "${v.chat}"  expires ${new Date(v.expiresAt).toLocaleString()}\n    → slopstream join ${v.code}`);
        console.log('');
      }
      if (!invites.length) console.log(incoming.length ? 'No invites of yours are open.' : 'No open invites.');
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
      const apcfg = needCfg();
      const ws = await admin(apcfg);
      ws.send(JSON.stringify({ t: 'list_requests' }));
      const { invites } = await nextMsg(ws, ['requests'], 5000);
      const v = invites.find(x => normCode(x.code) === normCode(code));
      if (!v) die(`No open invite ${code}.`);
      if (!v.requester) {
        if (cmd === 'approve') die(`Nobody has used invite ${v.code} yet.`);
        // `deny` on an invite nobody used withdraws it.
        ws.send(JSON.stringify({ t: 'invite_cancel', code: v.code }));
        const c = await nextMsg(ws, ['invite_cancelled'], 5000);
        console.log(`Withdrew invite ${c.code}.`);
        ws.close(); break;
      }
      let ok = false;
      if (cmd === 'approve') {
        const r = v.requester;
        console.log(`${r.user}${r.github ? ` (github.com/${r.github})` : ''} wants to link their chat "${r.chat}" with your chat "${v.chat}".`);
        ok = (await browserConfirms(apcfg)) || yes || /^y(es)?$/i.test((await ask('Approve? [y/N] ')).trim());
      }
      const mine = (m) => normCode(m.code) === normCode(v.code);
      const done = waitConfirming(ws, apcfg, ['paired', 'pair_denied'], mine, `Run: slopstream approve ${v.code}`, cmd === 'approve' ? 0 : 5000);
      ws.send(JSON.stringify({ t: 'pair_decision', code: v.code, ok }));
      const r = await done;
      console.log(r.t === 'paired' ? `Linked: ${v.chat} <-> ${r.members.map(p => `${p.user}/${p.chat}`).join(', ')}` : 'Denied.');
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
      const r = runInit({ chat, agent: await pickAgent(), cwd: process.cwd(), home: opt('home') });
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
    case 'doctor': process.exitCode = await runDoctor({ chat: opt('chat'), json: args.includes('--json') }); break;
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
  link [@user] [chat] [--agent ..] [--add]   make an invite link for this folder and wait for your teammate
                                      (with @user, only that person can use it; --add adds a person to an existing link)
  join <code-or-link> [chat]         link this folder to a teammate's invite
  requests                           invites made for you, your open invites, and who has used them
  approve <code> [--yes]             let in someone who used your invite (also later, after you closed link)
  deny <code>                        refuse such a request, or withdraw an invite nobody used
  links                              your links, and who is online in each
  unlink <chat>                      leave a link; dissolves it if fewer than 2 chats would remain
  pause <chat> / resume <chat>       stop / restart a chat connecting to the relay, without unlinking it
  init <chat> [--agent claude|codex] (in a project folder) re-wire this folder for Claude Code or Codex
  doctor [--chat <label>] [--json]   check every step (login, relay, this folder, link) and print the fix for each problem
  login [--relay <url>]              log in with GitHub (once per machine)
  devices [revoke <id>]              list (or revoke) the devices logged in as you
  logout                             revoke this device and forget the login
  setup <relay-url> <user> <token>   self-hosted relay without GitHub: save the token its admin gave you
  demo up|status|peer|down           test everything on THIS machine alone (see docs/testing.md)`);
  }
}
const quiet = cmd === 'codex-hook' || cmd === 'simulate' || (cmd === 'demo' && rest[0] === 'peer');
main().then(() => (quiet ? null : maybeNotifyUpdate())).then(() => process.exit(process.exitCode || 0)).catch((e) => die(e instanceof RelayError ? explain(e.code, e.message) : `error: ${e.message}`));
