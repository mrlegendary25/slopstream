import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeSecretStore } from './secrets.js';

// Every function takes an optional `home` so one machine can host several independent
// identities (that is how the solo `slopstream demo` works). Default: $SLOPSTREAM_HOME or ~/.slopstream.
export const defaultHome = () => process.env.SLOPSTREAM_HOME || path.join(os.homedir(), '.slopstream');
export const configFile = (home = defaultHome()) => path.join(home, 'config.json');
export const logFile = (home = defaultHome()) => path.join(home, 'log.jsonl');
export const codexThreadFile = (chat, home = defaultHome()) => path.join(home, 'codex-threads', `${chat}.json`);
export const pausedFile = (chat, home = defaultHome()) => path.join(home, 'paused', `${chat}.json`);

// The token lives in the OS keychain when there is one (bridge/secrets.js). config.json then has
// `tokenStore: 'keychain' | 'libsecret' | 'dpapi'` and no `token`. Without a keychain it stays in the file, as before.
const KEYCHAIN_KINDS = new Set(['keychain', 'libsecret', 'dpapi']);
let noticed = false;

export function secretAccount(cfg, home = defaultHome()) {
  let host = 'relay';
  try { host = new URL(cfg.relay).host || host; } catch { /* keep the default */ }
  const h = crypto.createHash('sha256').update(path.resolve(home)).digest('hex').slice(0, 12);
  return `${cfg.user}@${host.replace(/[^A-Za-z0-9.:-]/g, '_')}#${h}`;
}

const readRaw = (home) => { try { return JSON.parse(fs.readFileSync(configFile(home), 'utf8')); } catch { return null; } };

// Returns the kind it stored with ('keychain', ..., or 'file').
export function saveConfig(cfg, home = defaultHome(), { store = makeSecretStore() } = {}) {
  const { token, tokenError, tokenStore, tokenDpapi, ...rest } = cfg;
  let out = { ...rest, token, tokenStore: 'file' };
  if (token && store.kind !== 'file' && store.available()) {
    try {
      const account = secretAccount(cfg, home);
      const { blob } = store.set(account, token);
      if (store.get(account, blob) === token) { // only trust it once it reads back
        out = { ...rest, tokenStore: store.kind, ...(blob ? { tokenDpapi: blob } : {}) };
      }
    } catch { /* fall back to the file below */ }
  }
  if (out.tokenStore === 'file' && token && !noticed && process.env.SLOPSTREAM_KEYCHAIN !== 'off') {
    noticed = true;
    console.error(`Your login is saved in a plain file (no keychain available): ${configFile(home)}`);
  }
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile(home), JSON.stringify(out, null, 2), { mode: 0o600 });
  return out.tokenStore;
}

// `migrate` is for human CLI commands only: a plain token from an older version moves into the keychain.
// The bridge never migrates (it must not rewrite files while an agent is running).
export function loadConfig(home = defaultHome(), { migrate = false, store = makeSecretStore() } = {}) {
  const cfg = readRaw(home);
  if (!cfg) return null;
  if (KEYCHAIN_KINDS.has(cfg.tokenStore)) {
    let token = null;
    if (store.kind !== cfg.tokenStore) cfg.tokenError = `the login was saved in ${cfg.tokenStore}, which is not available here`;
    else { try { token = store.get(secretAccount(cfg, home), cfg.tokenDpapi); } catch { /* handled below */ } }
    if (!token && !cfg.tokenError) cfg.tokenError = `the ${cfg.tokenStore} has no saved login for ${cfg.user}`;
    return { ...cfg, token };
  }
  if (migrate && cfg.token && !cfg.tokenStore && store.kind !== 'file') {
    if (saveConfig(cfg, home, { store }) !== 'file') return readRaw(home) && loadConfig(home, { store });
  }
  return cfg;
}

// Removes the saved secret (the keychain item) for this login. Does not touch config.json.
export function deleteSecret(cfg, home = defaultHome(), { store = makeSecretStore() } = {}) {
  if (!cfg || !KEYCHAIN_KINDS.has(cfg.tokenStore) || store.kind !== cfg.tokenStore) return;
  try { store.del(secretAccount(cfg, home)); } catch { /* best effort */ }
}
export function logLine(obj, home = defaultHome()) {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.appendFileSync(logFile(home), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n', { mode: 0o600 });
  } catch { /* logging must never break the bridge */ }
}

// Where `slopstream login` goes when nothing else says otherwise. (The hosted relay.)
export const DEFAULT_RELAY = process.env.SLOPSTREAM_RELAY || 'wss://slopstream-relay.slopstream.workers.dev';
export const chatSettingsFile = (chat, home = defaultHome()) => path.join(home, 'chats', `${chat}.json`);
