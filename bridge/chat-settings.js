// Per-chat settings: <home>/chats/<chat>.json. One place for everything a person can tune for one folder's chat.
// Reading never throws: a missing or damaged file just means the defaults.
import fs from 'node:fs';
import path from 'node:path';
import { chatSettingsFile, defaultHome } from './config.js';

export const DEFAULT_SETTINGS = { v: 1, guard: true, maxTurns: 4, peers: {} };
const SAFE_NAME = /^[a-zA-Z0-9._-]{1,40}$/;

export function loadChatSettings(chat, home = defaultHome()) {
  const out = { ...DEFAULT_SETTINGS, peers: {} };
  if (!SAFE_NAME.test(String(chat || ''))) return out;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(chatSettingsFile(chat, home), 'utf8')); } catch { return out; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (typeof raw.guard === 'boolean') out.guard = raw.guard;
  if (Number.isInteger(raw.maxTurns) && raw.maxTurns >= 1 && raw.maxTurns <= 50) out.maxTurns = raw.maxTurns;
  if (raw.peers && typeof raw.peers === 'object' && !Array.isArray(raw.peers)) {
    for (const [k, v] of Object.entries(raw.peers)) if (SAFE_NAME.test(k) && v && typeof v === 'object' && !Array.isArray(v)) out.peers[k] = v;
  }
  return out;
}

// Atomic: write a temp file, then rename, so a reader never sees half a file.
export function saveChatSettings(chat, settings, home = defaultHome()) {
  if (!SAFE_NAME.test(String(chat || ''))) throw new Error('invalid chat label');
  const f = chatSettingsFile(chat, home);
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings, v: 1 }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
