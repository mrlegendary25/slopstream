// `slopstream doctor [--chat <label>] [--json]`: checks every step from "installed" to "my agent can reach theirs",
// and prints the exact fix for each failure. Run it in the project folder.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, configFile, defaultHome, pausedFile } from './config.js';
import { admin, nextMsg } from './net.js';
import { httpBase, getJson } from './http.js';
import { ver, atLeast, binFor, CLAUDE_MIN } from './agents.js';
import { VERSION, cmpVersion } from './version.js';
import { latestVersion } from './update-check.js';
import { RelayError } from './errors.js';

const START_CLAUDE = 'claude --dangerously-load-development-channels server:slopstream';
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// What this folder is wired to: { agent, chat, server, home } from .mcp.json or .codex/config.toml, or null.
function readFolder(cwd) {
  const mcp = read(path.join(cwd, '.mcp.json'));
  if (mcp) {
    try {
      const e = JSON.parse(mcp).mcpServers?.slopstream;
      if (e) return { agent: 'claude', chat: e.env?.SLOPSTREAM_CHAT || null, server: (e.args || [])[0] || null, home: e.env?.SLOPSTREAM_HOME || null };
    } catch { /* not JSON: treated as not wired */ }
  }
  const toml = read(path.join(cwd, '.codex', 'config.toml'));
  if (toml && /\[mcp_servers\.slopstream\]/.test(toml)) {
    const arg = /args\s*=\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(toml)?.[1];
    return {
      agent: 'codex',
      chat: /SLOPSTREAM_CHAT\s*=\s*"([^"]*)"/.exec(toml)?.[1] || null,
      server: arg ? arg.replace(/\\\\/g, '\\') : null,
      home: /SLOPSTREAM_HOME\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(toml)?.[1]?.replace(/\\\\/g, '\\') || null,
      hook: /\[\[hooks\.SessionStart\]\]/.test(toml) && /codex-hook/.test(toml),
    };
  }
  return null;
}

export async function collectChecks({ cwd = process.cwd(), chat: chatOpt, env = process.env, fetchLatest = latestVersion } = {}) {
  const out = [];
  const add = (id, ok, msg, fix) => { out.push({ id, ok, msg, ...(fix ? { fix } : {}) }); return ok; };
  const folder = readFolder(cwd);
  const home = env.SLOPSTREAM_HOME ? defaultHome() : (folder?.home || defaultHome());

  // 1. Node
  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20, `Node v${process.versions.node}`, major >= 20 ? null : 'Install Node 20 or newer: https://nodejs.org');

  // 2. version
  if (env.SLOPSTREAM_NO_UPDATE_CHECK) add('version', null, `slopstream ${VERSION} (update check is off)`);
  else {
    let latest = null; try { latest = await fetchLatest(); } catch { /* offline */ }
    if (!latest) add('version', null, `slopstream ${VERSION} (could not check for a newer one; offline?)`);
    else if (cmpVersion(latest, VERSION) > 0) add('version', false, `slopstream ${VERSION}, but ${latest} is out`, 'npm install -g slopstream@latest');
    else add('version', true, `slopstream ${VERSION} is current`);
  }

  // 3-4. login and token
  const cfg = loadConfig(home, { migrate: true });
  if (!cfg) add('login', false, `not logged in (no ${configFile(home)})`, 'slopstream login');
  else add('login', true, `logged in as ${cfg.user} on ${cfg.relay}`);
  if (cfg) {
    const where = { keychain: 'macOS Keychain', libsecret: 'the system keyring', dpapi: 'Windows protected storage', file: 'a plain file' }[cfg.tokenStore] || 'a plain file';
    if (cfg.token) add('token', true, `token read from ${where}`);
    else add('token', false, `the saved token could not be read from ${where}${cfg.tokenError ? ` (${cfg.tokenError})` : ''}`, 'slopstream login   (the keychain may be locked, or the item was deleted)');
  } else add('token', null, 'no login to read a token for');

  // 5-7. relay
  let relayUp = false;
  if (cfg) {
    let hz = null;
    try { hz = await getJson(`${httpBase(cfg.relay)}/healthz`); } catch { /* unreachable */ }
    relayUp = !!(hz && hz.ok);
    add('relay', relayUp, relayUp ? `relay reachable (${httpBase(cfg.relay)})` : `cannot reach the relay at ${httpBase(cfg.relay)}`,
      relayUp ? null : 'Check your internet connection, or the relay address (slopstream login --relay <url>)');
    if (relayUp) add('protocol', (hz.protocol || 0) >= 3, `relay speaks protocol ${hz.protocol}`, (hz.protocol || 0) >= 3 ? null : 'The relay is old. If you run it yourself, update it; otherwise tell its owner.');
    else add('protocol', null, 'skipped (relay unreachable)');
  } else { add('relay', null, 'skipped (not logged in)'); add('protocol', null, 'skipped'); }

  let ws = null;
  if (cfg && cfg.token && relayUp) {
    try { ws = await admin(cfg); add('auth', true, 'the relay accepts your login'); }
    catch (e) { add('auth', false, e instanceof RelayError && e.code === 'upgrade_required' ? 'the relay wants a newer slopstream' : 'the relay did not accept your login', e instanceof RelayError && e.code === 'upgrade_required' ? 'npm install -g slopstream@latest' : 'slopstream login'); }
  } else add('auth', null, 'skipped');

  // 8-10. the folder
  const chat = chatOpt || folder?.chat || null;
  if (!folder) add('folder', false, 'this folder is not set up for slopstream (no slopstream entry in .mcp.json or .codex/config.toml)', `slopstream init ${chat || '<chat>'}`);
  else if (!folder.server || !fs.existsSync(folder.server)) add('folder', false, `${folder.agent === 'claude' ? '.mcp.json' : '.codex/config.toml'} points at a file that is gone (${folder.server || 'no path'})`, 'npm install -g slopstream, then: slopstream init ' + (chat || '<chat>'));
  else if (folder.server.includes(`${path.sep}_npx${path.sep}`)) add('folder', false, "this folder points into npx's temporary cache, which can be deleted", 'npm install -g slopstream, then: slopstream init ' + (chat || '<chat>'));
  else add('folder', true, `folder is set up for ${folder.agent === 'claude' ? 'Claude Code' : 'Codex'}`);

  const rulesFile = folder ? (folder.agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md') : null;
  if (!folder) add('rules', null, 'skipped (folder is not set up)');
  else if ((read(path.join(cwd, rulesFile)) || '').includes('<!-- slopstream:start -->')) add('rules', true, `${rulesFile} has the safety rules`);
  else add('rules', false, `${rulesFile} is missing the slopstream safety rules`, `slopstream init ${chat || '<chat>'}`);

  add('chat', chat ? true : null, chat ? `chat label: ${chat}` : 'no chat label known (pass --chat <label>, or set the folder up first)');

  // 11. paused
  if (chat && fs.existsSync(pausedFile(chat, home))) add('paused', false, `chat "${chat}" is paused: nobody can reach it`, `slopstream resume ${chat}`);
  else add('paused', chat ? true : null, chat ? `chat "${chat}" is not paused` : 'skipped');

  // 12-14. links, peers, session
  let mine = null;
  if (ws && chat) {
    try {
      ws.send(JSON.stringify({ t: 'list_links' }));
      const { links } = await nextMsg(ws, ['links'], 5000);
      const link = links.find(l => l.members.some(m => m.user === cfg.user && m.chat === chat));
      if (link) mine = { link, me: link.members.find(m => m.user === cfg.user && m.chat === chat), peers: link.members.filter(m => !(m.user === cfg.user && m.chat === chat)) };
    } catch { /* treated as unknown below */ }
    try { ws.close(); } catch { /* closing */ }
  } else if (ws) { try { ws.close(); } catch { /* closing */ } }
  if (!ws || !chat) { add('linked', null, 'skipped'); add('peers', null, 'skipped'); add('session', null, 'skipped'); }
  else if (!mine) { add('linked', false, `chat "${chat}" is not linked to anyone`, 'slopstream link   (or: slopstream join <code>)'); add('peers', null, 'skipped'); add('session', null, 'skipped'); }
  else {
    add('linked', true, `linked with ${mine.peers.map(p => `${p.user}/${p.chat}`).join(', ')}`);
    add('peers', null, mine.peers.map(p => `${p.user} is ${p.online ? 'online' : 'offline'}`).join(', '));
    add('session', null, mine.me.online ? "this chat's agent session is online" : `this chat's agent session is not running. Start it with: ${folder?.agent === 'codex' ? 'codex' : START_CLAUDE}`);
  }

  // the tool guard hooks (Claude folders)
  if (folder?.agent === 'claude') {
    let hooks = null; try { hooks = JSON.parse(read(path.join(cwd, '.claude', 'settings.local.json')) || '{}').hooks || null; } catch { /* unreadable */ }
    const has = (ev) => (hooks?.[ev] || []).some(e => (e.hooks || []).some(h => String(h.command || '').includes('hook.js')));
    if (has('PreToolUse') && has('UserPromptSubmit')) add('hooks', true, 'the tool guard and prompt hooks are installed');
    else add('hooks', false, "the tool guard hooks are not installed in this folder, so a peer's message isn't stopped from leading to a tool call", `slopstream init ${chat || '<chat>'}`);
  } else add('hooks', null, folder ? 'no hooks for Codex (its own approval pop-up covers this)' : 'skipped');

  // 15-16. agent
  if (folder?.agent === 'claude') {
    const c = ver(binFor('claude', env));
    if (!c) add('claude', false, 'Claude Code was not found on this machine', 'Install Claude Code: https://claude.com/claude-code');
    else if (!atLeast(c.parts, CLAUDE_MIN)) add('claude', false, `Claude Code ${c.text} is too old for channels (needs 2.1.80)`, 'claude update');
    else add('claude', true, `Claude Code ${c.text}`);
  } else add('claude', null, 'not a Claude folder');
  if (folder?.agent === 'codex') {
    const c = ver(binFor('codex', env));
    if (!c) add('codex', false, 'Codex was not found on this machine', 'Install Codex: https://github.com/openai/codex');
    else if (!folder.hook) add('codex', false, 'the Codex hook that records this chat is missing from .codex/config.toml', `slopstream init ${chat || '<chat>'} --agent codex`);
    else add('codex', true, `Codex ${c.text}, hook present`);
  } else add('codex', null, 'not a Codex folder');

  return out;
}

export async function runDoctor({ chat, json = false, cwd = process.cwd() } = {}) {
  const checks = await collectChecks({ cwd, chat });
  if (json) { console.log(JSON.stringify(checks, null, 2)); return checks.some(c => c.ok === false) ? 1 : 0; }
  console.log('slopstream doctor');
  for (const c of checks) {
    console.log(`  ${c.ok === true ? '✓' : c.ok === false ? '✗' : '-'} ${c.msg}`);
    if (c.ok === false && c.fix) console.log(`      → ${c.fix}`);
  }
  const bad = checks.filter(c => c.ok === false).length;
  console.log(bad ? `\n${bad} problem${bad > 1 ? 's' : ''} found. Fix the first ✗ and run: slopstream doctor` : '\nAll good.');
  return bad ? 1 : 0;
}
