// `slopstream status`: is this machine ready? Checks Node, saved login, relay reachability,
// your links and who is online right now, and which agents are installed.
import { spawnSync } from 'node:child_process';
import { loadConfig, configFile } from './config.js';
import { admin, nextMsg } from './net.js';

const ver = (cmd) => {
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 8000 });
    if (r.error || r.status !== 0) return null;
    const m = (r.stdout || r.stderr || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? { text: m[0], parts: [+m[1], +m[2], +m[3]] } : { text: '(version unknown)', parts: null };
  } catch { return null; }
};
const atLeast = (parts, min) => { if (!parts) return true; for (let i = 0; i < 3; i++) { if (parts[i] !== min[i]) return parts[i] > min[i]; } return true; };

export async function runStatus() {
  const line = (ok, msg) => console.log(`  ${ok === true ? '✓' : ok === false ? '✗' : '-'} ${msg}`);
  let bad = false;
  console.log('slopstream status');

  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 20, `Node v${process.versions.node} (needs 20 or newer)`); if (major < 20) bad = true;

  const cfg = loadConfig();
  if (!cfg) { line(false, `no saved login. Run: slopstream setup <relay-url> <user> <token>   (expected ${configFile()})`); return 1; }
  line(true, `saved login: user "${cfg.user}", relay ${cfg.relay}`);

  let ws;
  try { ws = await admin(cfg); line(true, 'relay reachable and login accepted'); }
  catch (e) { line(false, e.message); line(null, 'hint: is the relay running, and is Tailscale connected on both Macs?'); bad = true; }

  if (ws) {
    try {
      ws.send(JSON.stringify({ t: 'list_links' }));
      const r = await nextMsg(ws, ['links']);
      if (!r.links.length) line(null, 'no links yet. Pair a chat with: slopstream pair-create <chat>');
      for (const l of r.links) {
        const meIsA = l.a.user === cfg.user; const me = meIsA ? l.a : l.b; const peer = meIsA ? l.b : l.a;
        const meOn = meIsA ? l.online?.a : l.online?.b; const peerOn = meIsA ? l.online?.b : l.online?.a;
        console.log(`  • ${me.chat}  <->  ${peer.user}/${peer.chat}     your session: ${meOn ? 'online' : 'offline'}   their session: ${peerOn ? 'online' : 'offline'}`);
      }
    } catch (e) { line(false, `could not list links: ${e.message}`); bad = true; }
    try { ws.close(); } catch {}
  }

  const claude = ver('claude');
  if (!claude) line(null, 'Claude Code: not found on this machine (only needed if you use Claude)');
  else line(atLeast(claude.parts, [2, 1, 80]), `Claude Code ${claude.text} (channels need 2.1.80 or newer)`);
  const codex = ver('codex');
  line(null, codex ? `Codex ${codex.text}` : 'Codex: not found on this machine (only needed if you use Codex)');
  return bad ? 1 : 0;
}
