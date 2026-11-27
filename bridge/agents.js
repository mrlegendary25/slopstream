// Which agent (Claude Code or Codex) is this folder for? Looks at what is installed and what the folder already has.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// run(cmd, args) -> { status, stdout, stderr }, injectable for tests.
const defaultRun = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000 });

export function ver(cmd, run = defaultRun) {
  try {
    const r = run(cmd, ['--version']);
    if (!r || r.error || r.status !== 0) return null;
    const m = (r.stdout || r.stderr || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? { text: m[0], parts: [+m[1], +m[2], +m[3]] } : { text: '(version unknown)', parts: null };
  } catch { return null; }
}
export const atLeast = (parts, min) => { if (!parts) return true; for (let i = 0; i < 3; i++) { if (parts[i] !== min[i]) return parts[i] > min[i]; } return true; };

export const CLAUDE_MIN = [2, 1, 80];

// SLOPSTREAM_CLAUDE_BIN / SLOPSTREAM_CODEX_BIN: full path to the binary, for installs that are not on PATH (and for tests).
export const binFor = (name, env = process.env) => env[`SLOPSTREAM_${name.toUpperCase()}_BIN`] || name;

export function detectAgents({ cwd = process.cwd(), run = defaultRun } = {}) {
  const installed = { claude: ver(binFor('claude'), run), codex: ver(binFor('codex'), run) };
  const has = (f) => fs.existsSync(path.join(cwd, f));
  const codexFolder = has('.codex');
  const claudeFolder = has('.mcp.json') || has('CLAUDE.md');
  const hint = codexFolder && !claudeFolder ? 'codex' : claudeFolder && !codexFolder ? 'claude' : null;
  return { installed, hint };
}

const NAME = { claude: 'Claude Code', codex: 'Codex' };

// Returns { agent, why, warnings[] }. `why` is a short phrase for the one line we print.
export async function chooseAgent({ flag, detected, isTTY = false, ask = async () => '' }) {
  const warnings = [];
  const { installed, hint } = detected;
  let agent, why;
  if (flag) { agent = String(flag).toLowerCase(); why = 'from --agent'; }
  else if (installed.claude && !installed.codex) { agent = 'claude'; why = 'the only agent installed'; }
  else if (installed.codex && !installed.claude) { agent = 'codex'; why = 'the only agent installed'; }
  else if (installed.claude && installed.codex) {
    if (hint) { agent = hint; why = `this folder already uses ${NAME[hint]}`; }
    else if (isTTY) {
      const a = (await ask('Which agent will use this folder? [1] Claude Code  [2] Codex (default 1): ')).trim();
      agent = a === '2' || /^codex$/i.test(a) ? 'codex' : 'claude'; why = 'your choice';
    } else { agent = 'claude'; why = 'both are installed and this folder does not say which'; }
  } else {
    agent = 'claude'; why = 'no agent found on this machine yet';
    warnings.push('Neither Claude Code nor Codex was found. Install one first: Claude Code https://claude.com/claude-code  or  Codex https://github.com/openai/codex');
  }
  if (agent === 'claude' && installed.claude && !atLeast(installed.claude.parts, CLAUDE_MIN)) {
    warnings.push(`Channels need Claude Code 2.1.80 or newer (you have ${installed.claude.text}): claude update`);
  }
  return { agent, why, warnings };
}

export const describeChoice = ({ agent, why }) => `Using ${NAME[agent] || agent} for this folder (${why}). To use the other one: --agent ${agent === 'claude' ? 'codex' : 'claude'}`;
