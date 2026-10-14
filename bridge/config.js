import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every function takes an optional `home` so one machine can host several independent
// identities (that is how the solo `slopstream demo` works). Default: $SLOPSTREAM_HOME or ~/.slopstream.
export const defaultHome = () => process.env.SLOPSTREAM_HOME || path.join(os.homedir(), '.slopstream');
export const configFile = (home = defaultHome()) => path.join(home, 'config.json');
export const logFile = (home = defaultHome()) => path.join(home, 'log.jsonl');
export const codexThreadFile = (chat, home = defaultHome()) => path.join(home, 'codex-threads', `${chat}.json`);

export function loadConfig(home = defaultHome()) {
  try { return JSON.parse(fs.readFileSync(configFile(home), 'utf8')); } catch { return null; }
}
export function saveConfig(cfg, home = defaultHome()) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile(home), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
export function logLine(obj, home = defaultHome()) {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.appendFileSync(logFile(home), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n', { mode: 0o600 });
  } catch { /* logging must never break the bridge */ }
}
