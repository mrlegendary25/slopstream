// "A newer slopstream is available": asks the npm registry (not the relay), at most once a day, only for a person at a terminal.
import fs from 'node:fs';
import path from 'node:path';
import { defaultHome } from './config.js';
import { VERSION, cmpVersion } from './version.js';

export async function latestVersion(timeoutMs = 3000) {
  const r = await fetch('https://registry.npmjs.org/slopstream/latest', { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!r.ok) return null;
  const v = (await r.json()).version;
  return /^\d+\.\d+\.\d+/.test(v) ? v : null;
}

export async function maybeNotifyUpdate({ home = defaultHome(), now = Date.now(), fetchLatest = latestVersion } = {}) {
  try {
    if (!process.stdout.isTTY || process.env.SLOPSTREAM_NO_UPDATE_CHECK) return;
    const file = path.join(home, 'update-check.json');
    let rec = {};
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    if (now - (rec.checkedAt || 0) < 24 * 3600 * 1000) {
      if (rec.latest && cmpVersion(rec.latest, VERSION) > 0) console.error(`A newer slopstream is available (${rec.latest}, you have ${VERSION}): npm install -g slopstream@latest`);
      return;
    }
    const latest = await fetchLatest();
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ checkedAt: now, latest }), { mode: 0o600 });
    if (latest && cmpVersion(latest, VERSION) > 0) console.error(`A newer slopstream is available (${latest}, you have ${VERSION}): npm install -g slopstream@latest`);
  } catch { /* never breaks a command */ }
}
