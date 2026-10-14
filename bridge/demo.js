// `slopstream demo up|status|peer|down`: a complete two-person test on THIS laptop.
//   - a private relay on 127.0.0.1 running in the background (no Tailscale, no second person)
//   - two fake people, "demo-a" and "demo-b", each with their own settings folder
//   - one link between them (chat label "demo")
//   - two project folders, each wired up for an agent (claude or codex)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { saveConfig, loadConfig } from './config.js';
import { pairBoth, listLinks } from './net.js';
import { runInit } from './init.js';
import { runSimulate } from './simulate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RELAY = path.join(ROOT, 'relay', 'server.js');
const ADMIN = path.join(ROOT, 'relay', 'admin.js');
const MARK = '.slopstream-demo';
const CHAT = 'demo';
const AGENTS = ['claude', 'codex'];
const defaultDir = () => path.join(os.homedir(), '.slopstream-demo');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const paths = (dir) => ({
  dir, state: path.join(dir, 'demo.json'), relayData: path.join(dir, 'relay-data'), relayLog: path.join(dir, 'relay.log'),
  homeA: path.join(dir, 'home-a'), homeB: path.join(dir, 'home-b'), a: path.join(dir, 'folder-a'), b: path.join(dir, 'folder-b'),
});
const readState = (P) => { try { return JSON.parse(fs.readFileSync(P.state, 'utf8')); } catch { return null; } };

async function waitForRelay(url, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((res) => { const ws = new WebSocket(url); ws.once('open', () => { ws.close(); res(true); }); ws.once('error', () => res(false)); });
    if (ok) return true;
    await sleep(150);
  }
  return false;
}

const launchLine = (agent, folder) => agent === 'claude'
  ? `cd ${folder} && claude --dangerously-load-development-channels server:slopstream`
  : `cd ${folder} && codex`;

export async function demoUp({ dir, a = 'claude', b = 'claude', port = 18787, bin = 'slopstream' }) {
  for (const x of [a, b]) if (!AGENTS.includes(x)) throw new Error(`agent must be "claude" or "codex" (got "${x}")`);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be a number between 1024 and 65535');
  const P = paths(path.resolve(dir || defaultDir()));
  const old = readState(P);
  if (old && alive(old.pid)) throw new Error(`a demo relay is already running (pid ${old.pid}). Run \`${bin} demo down\` first.`);
  if (fs.existsSync(P.dir)) {
    if (fs.existsSync(path.join(P.dir, MARK))) fs.rmSync(P.dir, { recursive: true, force: true });
    else if (fs.readdirSync(P.dir).length) throw new Error(`${P.dir} already exists and is not a slopstream demo folder. Pick another with --dir.`);
  }
  for (const p of [P.relayData, P.homeA, P.homeB, P.a, P.b]) fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(P.dir, MARK), 'created by `slopstream demo`; safe to delete\n');

  const log = fs.openSync(P.relayLog, 'a');
  const relay = spawn(process.execPath, [RELAY], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: P.relayData },
    detached: true, stdio: ['ignore', log, log],
  });
  relay.unref();
  const url = `ws://127.0.0.1:${port}`;
  if (!(await waitForRelay(url))) {
    try { process.kill(relay.pid); } catch {}
    const txt = fs.readFileSync(P.relayLog, 'utf8');
    throw new Error(`the demo relay did not start. ${/EADDRINUSE/.test(txt) ? `Port ${port} is busy: try --port ${port + 1}` : txt.trim().slice(-300)}`);
  }
  try {
    const token = (name) => {
      const r = spawnSync(process.execPath, [ADMIN, 'add-user', name], { encoding: 'utf8', env: { ...process.env, DATA_DIR: P.relayData } });
      const m = (r.stdout || '').match(/token: (\S+)/); if (!m) throw new Error(`could not create user ${name}: ${r.stderr}`);
      return m[1];
    };
    const cfgA = { relay: url, user: 'demo-a', token: token('demo-a') };
    const cfgB = { relay: url, user: 'demo-b', token: token('demo-b') };
    saveConfig(cfgA, P.homeA); saveConfig(cfgB, P.homeB);
    await pairBoth(cfgA, CHAT, cfgB, CHAT);
    runInit({ chat: CHAT, agent: a, cwd: P.a, home: P.homeA });
    runInit({ chat: CHAT, agent: b, cwd: P.b, home: P.homeB });
    fs.writeFileSync(P.state, JSON.stringify({ pid: relay.pid, port, a, b }, null, 2));
  } catch (e) { try { process.kill(relay.pid); } catch {} throw e; }

  console.log(`
DEMO READY. Two fake people now share this laptop, linked chat-to-chat:
  person A  ${a.padEnd(6)}  folder ${P.a}
  person B  ${b.padEnd(6)}  folder ${P.b}
The relay runs in the background (pid ${relay.pid}, port ${port}). Stop it with:  ${bin} demo down

Test with no AI at all (free, tests the plumbing). Two new terminals:
  ${bin} demo peer --side a
  ${bin} demo peer --side b
Type a line in one and press Enter; it arrives in the other.

Test with the real agents. Two new terminals:
  ${launchLine(a, P.a)}
  ${launchLine(b, P.b)}
Check who is online any time:  ${bin} demo status`);
}

export async function demoStatus() {
  const P = paths(defaultDir()); const st = readState(P);
  if (!st) { console.log('no demo. Start one with: slopstream demo up'); return 0; }
  const up = alive(st.pid);
  console.log(`demo relay: ${up ? `running (pid ${st.pid}, port ${st.port})` : 'NOT running. Run `slopstream demo up` again'}`);
  if (!up) return 1;
  const cfg = loadConfig(P.homeA);
  let links;
  try { links = await listLinks(cfg); } catch { console.log('  the relay is not answering. Run `slopstream demo down` then `slopstream demo up`.'); return 1; }
  for (const l of links) {
    console.log(`  chat "${l.a.chat}":  person A (${st.a}) ${l.online?.a ? 'ONLINE' : 'offline'}   <->   person B (${st.b}) ${l.online?.b ? 'ONLINE' : 'offline'}`);
  }
  return 0;
}

export async function demoPeer({ side, agent, linger }) {
  const P = paths(defaultDir()); const st = readState(P);
  if (!st || !alive(st.pid)) throw new Error('no demo relay is running. Run: slopstream demo up');
  if (!['a', 'b'].includes(side)) throw new Error('--side must be a or b');
  process.env.SLOPSTREAM_HOME = side === 'a' ? P.homeA : P.homeB;
  return runSimulate({ chat: CHAT, agent: agent || st[side], linger });
}

export function demoDown() {
  const P = paths(defaultDir()); const st = readState(P);
  if (!st) { console.log('no demo to stop.'); return; }
  if (alive(st.pid)) { try { process.kill(st.pid, 'SIGTERM'); } catch {} console.log(`stopped the demo relay (pid ${st.pid}).`); fs.rmSync(P.state, { force: true }); }
  else console.log('the demo relay was already stopped.');
  console.log(`Files are kept in ${P.dir} (delete that folder when you're finished).`);
}
