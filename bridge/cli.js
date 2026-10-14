#!/usr/bin/env node
// slopstream CLI: setup, pairing (human-approved on BOTH sides), links, unlink, init.
// Deliberately NOT available to the agent.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig, saveConfig, configFile, codexThreadFile } from './config.js';
import { admin, nextMsg } from './net.js';
import { runInit } from './init.js';
import { runStatus } from './status.js';
import { runSimulate } from './simulate.js';
import { demoUp, demoStatus, demoPeer, demoDown } from './demo.js';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
const optVals = new Set(['agent', 'chat', 'home', 'a', 'b', 'port', 'dir', 'side', 'linger'].map(n => args.indexOf(`--${n}`)).filter(i => i >= 0).map(i => i + 1));
const pos = args.filter((a, i) => !a.startsWith('--') && !optVals.has(i));
const [cmd, ...rest] = pos;
const die = (m) => { console.error(m); process.exit(1); };

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a); }); });
const needCfg = () => loadConfig() || die('Not set up. Run: slopstream setup <relay-url> <your-user> <your-token>');

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
    case 'pair-create': {
      const chat = rest[0]; if (!chat) die('usage: slopstream pair-create <chat-label> [--yes]');
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'pair_create', chat }));
      const c = await nextMsg(ws, ['pair_code']);
      console.log(`\nPairing code for chat "${chat}":  ${c.code}   (valid ${c.expiresInSec / 60} min)\nGive it to your friend. They run:  slopstream pair-accept ${c.code} <their-chat-label>\nWaiting...`);
      const req = await nextMsg(ws, ['pair_request']);
      console.log(`\n${req.from.user} wants to link their chat "${req.from.chat}" to your chat "${chat}".`);
      const ok = yes || /^y(es)?$/i.test((await ask('Approve? [y/N] ')).trim());
      ws.send(JSON.stringify({ t: 'pair_decision', code: req.code, ok }));
      const r = await nextMsg(ws, ['paired', 'pair_denied']);
      console.log(r.t === 'paired' ? `Linked: ${chat} <-> ${r.peer.user}/${r.peer.chat}` : 'Denied.');
      ws.close(); break;
    }
    case 'pair-accept': {
      const [code, chat] = rest; if (!code || !chat) die('usage: slopstream pair-accept <code> <chat-label>');
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'pair_accept', code, chat }));
      const w = await nextMsg(ws, ['pair_waiting']); console.log(w.message);
      const r = await nextMsg(ws, ['paired', 'pair_denied']);
      console.log(r.t === 'paired' ? `Linked: ${chat} <-> ${r.peer.user}/${r.peer.chat}` : 'Denied by the other side.');
      ws.close(); break;
    }
    case 'links': {
      const cfg = needCfg(); const ws = await admin(cfg);
      ws.send(JSON.stringify({ t: 'list_links' }));
      const r = await nextMsg(ws, ['links']);
      if (!r.links.length) console.log('(no links)');
      for (const l of r.links) {
        const me = l.a.user === cfg.user ? l.a : l.b; const peer = me === l.a ? l.b : l.a;
        console.log(`${me.chat}  <->  ${peer.user}/${peer.chat}   (since ${l.createdAt})`);
      }
      ws.close(); break;
    }
    case 'unlink': {
      const chat = rest[0]; if (!chat) die('usage: slopstream unlink <chat-label>');
      const ws = await admin(needCfg());
      ws.send(JSON.stringify({ t: 'unlink', chat }));
      await nextMsg(ws, ['unlinked_ok']); console.log(`Unlinked "${chat}".`); ws.close(); break;
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
    case 'status': process.exitCode = await runStatus(); break;
    case 'simulate': {
      const chat = opt('chat'); if (!chat) die('usage: slopstream simulate --chat <chat-label> [--agent claude|codex]');
      if (opt('home')) process.env.SLOPSTREAM_HOME = path.resolve(opt('home'));
      await runSimulate({ chat, agent: opt('agent') || 'claude', linger: opt('linger') !== undefined ? Number(opt('linger')) : undefined });
      return new Promise(() => {}); // runSimulate exits the process itself
    }
    case 'demo': {
      const sub = rest[0];
      if (sub === 'up') await demoUp({ dir: opt('dir'), a: opt('a') || 'claude', b: opt('b') || 'claude', port: opt('port') ? Number(opt('port')) : 18787 });
      else if (sub === 'status') process.exitCode = await demoStatus();
      else if (sub === 'down') demoDown();
      else if (sub === 'peer') { await demoPeer({ side: opt('side'), agent: opt('agent'), linger: opt('linger') !== undefined ? Number(opt('linger')) : undefined }); return new Promise(() => {}); }
      else die('usage: slopstream demo up [--a claude|codex] [--b claude|codex] [--port N]\n       slopstream demo status | down\n       slopstream demo peer --side a|b');
      break;
    }
    default:
      console.log(`slopstream: seamless slop grenades. Safety pin included.

usage: slopstream <command>
  setup <relay-url> <user> <token>   save credentials (once per machine)
  pair-create <chat> [--yes]         make a pairing code for a chat, wait for friend, approve
  pair-accept <code> <chat>          accept a friend's code for one of your chats
  links                              list your links
  unlink <chat>                      cut a link immediately
  init <chat> [--agent claude|codex]  (in a project folder) wire this folder up for Claude Code or Codex
  status                             is this machine ready? who is online?
  demo up|status|peer|down           test everything on THIS laptop alone (see TESTING.md)
  simulate --chat <chat> [--agent]   stand-in agent with no AI, for testing the plumbing`);
  }
}
main().then(() => process.exit(process.exitCode || 0)).catch((e) => die(`error: ${e.message}`));
