// `slopstream login`: GitHub device-flow login, run by the RELAY (the GitHub token never reaches this machine).
import os from 'node:os';
import { spawn } from 'node:child_process';
import { loadConfig, saveConfig, DEFAULT_RELAY } from './config.js';
import { admin } from './net.js';
import { RelayError } from './errors.js';
import { httpBase, getJson, postJson } from './http.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function openBrowser(url) {
  if (process.env.SLOPSTREAM_NO_BROWSER) return;
  if (!/^https:\/\/github\.com\/[A-Za-z0-9/_-]+$/.test(url)) return; // only ever open the real GitHub device page
  const [cmd, ...a] = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url]
    : ['xdg-open', url];
  try { const p = spawn(cmd, a, { detached: true, stdio: 'ignore' }); p.on('error', () => {}); p.unref(); } catch { /* ignore */ }
}

export async function runLogin({ relay } = {}) {
  relay = relay || loadConfig()?.relay || DEFAULT_RELAY;
  const base = httpBase(relay);
  const info = await getJson(`${base}/v1/info`);
  if (!info.github) {
    throw new RelayError('github_disabled');
  }
  const start = await postJson(`${base}/v1/auth/github/start`, { label: `${os.hostname()} (${process.platform})` });
  if (start.status !== 'started') throw new RelayError(start.code || 'github_unavailable', start.message);
  console.log(`To log in, open  ${start.verification_uri}  and enter:  ${start.user_code}\nWaiting for GitHub...`);
  openBrowser(start.verification_uri);

  let interval = start.interval || 5;
  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const r = await postJson(`${base}/v1/auth/github/poll`, { poll_id: start.poll_id });
    if (r.status === 'pending') { interval = r.interval || interval; continue; }
    if (r.status === 'ok') {
      const cfg = { relay, user: r.user, token: r.token, deviceId: r.device_id, auth: 'github' };
      const ws = await admin(cfg); ws.close();
      saveConfig(cfg);
      console.log(`Logged in as ${r.user} on ${relay}`);
      return cfg;
    }
    if (r.status === 'denied') throw new Error('Login denied on GitHub.');
    if (r.status === 'expired') throw new Error('The login code expired. Run: slopstream login');
    if (r.status === 'error' && r.code === 'name_taken') throw new RelayError('name_taken', r.message);
    if (r.status === 'error' && r.httpStatus === 502) continue; // GitHub hiccup: keep trying until the deadline
    throw new RelayError(r.code || 'github_unavailable', r.message);
  }
  throw new Error('The login code expired. Run: slopstream login');
}
