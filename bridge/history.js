// `slopstream history`: your own record of what was sent and received, from the local log. This is the only place message
// text exists (the relay keeps none), and it never leaves your machine.
import fs from 'node:fs';
import path from 'node:path';
import { logFile, defaultHome } from './config.js';

export const parseSince = (s, now = Date.now()) => {
  const m = /^(\d+)\s*([hdw])$/i.exec(String(s || ''));
  if (!m) return 0;
  return now - Number(m[1]) * { h: 3600000, d: 86400000, w: 7 * 86400000 }[m[2].toLowerCase()];
};

export function logFiles(home = defaultHome()) {
  let rotated = [];
  try { rotated = fs.readdirSync(home).filter(n => /^log-.*\.jsonl$/.test(n)).sort(); } catch { /* no folder yet */ }
  return [...rotated.map(n => path.join(home, n)), logFile(home)];
}

// Oldest first. Lines that aren't JSON are skipped.
export function readLog(home, { chat, peer, sinceMs = 0 } = {}) {
  const out = [];
  for (const f of logFiles(home)) {
    let raw = ''; try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.dir !== 'in' && e.dir !== 'out') continue;
      if (chat && e.chat !== chat) continue;
      if (peer && (e.dir === 'out' ? e.to : e.from) !== peer) continue;
      if (sinceMs && Date.parse(e.ts) < sinceMs) continue;
      out.push(e);
    }
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

const LABELS = { auto: 'written automatically', agent: 'sent by their agent', 'human-approved': 'approved in a pop-up' };
export function formatEntry(e, { tty = false } = {}) {
  const when = new Date(e.ts).toLocaleString();
  const out = e.dir === 'out';
  const peer = out ? e.to : e.from;
  let status;
  if (out) status = e.blocked ? `not sent (${e.reason || 'declined'})` : e.delivered === false ? `not delivered (${e.reason || 'unknown'})` : e.note ? e.note : 'delivered';
  else status = e.blocked ? `declined (${e.reason || 'no reason'})` : 'received';
  const label = e.label ? ` [${LABELS[e.label] || e.label}]` : '';
  let text = e.text ? String(e.text).replace(/\s+/g, ' ') : '';
  if (tty && text.length > 200) text = text.slice(0, 200) + '…';
  return `${when}  ${out ? '→' : '←'} ${peer || '?'}${e.chat ? ` (${e.chat})` : ''}${label}  ${status}${text ? `\n    ${text}` : ''}`;
}

export function clearLogs(home = defaultHome()) {
  let n = 0;
  for (const f of logFiles(home)) { try { fs.rmSync(f); n++; } catch { /* not there */ } }
  return n;
}
