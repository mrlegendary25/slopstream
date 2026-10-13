import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.CLAUDE_LINK_HOME || path.join(os.homedir(), '.claude-link');
export const CONFIG_FILE = path.join(HOME, 'config.json');
export const LOG_FILE = path.join(HOME, 'log.jsonl');

export function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}
export function saveConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
export function logLine(obj) {
  try {
    fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
    fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n', { mode: 0o600 });
  } catch { /* logging must never break the bridge */ }
}
