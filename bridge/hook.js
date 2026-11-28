#!/usr/bin/env node
// Claude Code hooks for one chat. Runs on EVERY tool call and every prompt, so it stays small: no ws, no MCP SDK, no keychain.
//   hook.js prompt   --chat X [--home H]   a person typed in the chat: remember it (the turn limit and the guard use it)
//   hook.js pre-tool --chat X [--home H]   before a tool runs: make Claude Code ask the person when it matters (decision E12)
// If anything here fails, Claude Code carries on as normal: a broken hook must never stop someone working.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readActivity, writeActivity } from './activity.js';
import { loadChatSettings } from './chat-settings.js';

// Tools that only look. Everything else asks once a peer's message is waiting for the person's reply.
export const SAFE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'mcp__slopstream__link_status']);
const FILE_KEYS = ['file_path', 'path', 'notebook_path'];

const ask = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } });

const expand = (p) => (String(p).startsWith('~') ? path.join(os.homedir(), String(p).slice(1)) : String(p));
function insideHome(p, home, cwd) {
  try {
    const abs = path.resolve(cwd || process.cwd(), expand(p));
    // The folder this chat uses, and the default one (a different home may hold the same kind of secrets).
    return [path.resolve(home), path.join(os.homedir(), '.slopstream')].some((h) => {
      const rel = path.relative(h, abs);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  } catch { return false; }
}

// A shell command that runs slopstream, or names its folder.
export function touchesSlopstream(input, home, cwd) {
  if (!input || typeof input !== 'object') return false;
  const cmd = typeof input.command === 'string' ? input.command : '';
  if (cmd) {
    if (/(^|[\s;&|(`'"\/\\])slopstream(\s|$|['")`])/.test(cmd) || /\.slopstream/.test(cmd) || cmd.includes(path.resolve(home))) return true;
  }
  for (const k of FILE_KEYS) if (typeof input[k] === 'string' && insideHome(input[k], home, cwd)) return true;
  return false;
}

// Pure decision: returns a hook output object, or null for "no opinion".
export function decide({ tool, input, home, cwd, settings, activity }) {
  if (touchesSlopstream(input, home, cwd)) return ask("This touches Slopstream's settings or keys. Slopstream asks you to confirm it yourself.");
  if (settings.guard && (activity.lastInboundAt || 0) > (activity.lastHumanAt || 0) && !SAFE_TOOLS.has(tool)) {
    return ask("A message from another person's agent arrived after your last message. Slopstream asks you to confirm this tool call yourself.");
  }
  return null;
}

// A channel push that Claude Code may report as a prompt is not a person typing.
export const isChannelPush = (p) => /<channel\b[^>]*source="slopstream"/.test(String(p)) || /\[UNTRUSTED message from /.test(String(p));

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const opt = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
  const chat = opt('chat') || process.env.SLOPSTREAM_CHAT;
  const home = path.resolve(opt('home') || process.env.SLOPSTREAM_HOME || path.join(os.homedir(), '.slopstream'));
  let raw = ''; for await (const c of process.stdin) raw += c;
  let j = {}; try { j = JSON.parse(raw); } catch { /* no input: no opinion */ }
  if (mode === 'prompt') {
    if (chat && !isChannelPush(j.prompt)) { const now = Date.now(); writeActivity(chat, { lastPromptAt: now, lastHumanAt: now }, home); }
    return; // 2C adds the digest here
  }
  if (mode === 'pre-tool') {
    const settings = chat ? loadChatSettings(chat, home) : { guard: true };
    const activity = chat ? readActivity(chat, home) : {};
    const out = decide({ tool: String(j.tool_name || ''), input: j.tool_input, home, cwd: j.cwd, settings, activity });
    if (out) process.stdout.write(JSON.stringify(out));
  }
}

// Only run when started as a script (the tests import decide/touchesSlopstream).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(() => {}).finally(() => process.exit(0));
}
