// What a person and the peer did lately in one chat, as three timestamps in <home>/activity/<chat>.json:
//   lastPromptAt   the person typed in the chat (written by the prompt hook)
//   lastHumanAt    the latest of: a prompt, an approval in a pop-up
//   lastInboundAt  the bridge received a message from a peer
// Several processes write it (the bridge, the hooks), so every write reads, merges and renames. A damaged or missing file means "no information".
import fs from 'node:fs';
import path from 'node:path';
import { activityFile, defaultHome } from './config.js';

const SAFE_NAME = /^[a-zA-Z0-9._-]{1,40}$/;
const FIELDS = ['lastPromptAt', 'lastHumanAt', 'lastInboundAt'];

export function readActivity(chat, home = defaultHome()) {
  const out = {};
  if (!SAFE_NAME.test(String(chat || ''))) return out;
  let raw; try { raw = JSON.parse(fs.readFileSync(activityFile(chat, home), 'utf8')); } catch { return out; }
  if (!raw || typeof raw !== 'object') return out;
  for (const f of FIELDS) if (Number.isFinite(raw[f]) && raw[f] > 0) out[f] = raw[f];
  return out;
}

export function writeActivity(chat, patch, home = defaultHome()) {
  if (!SAFE_NAME.test(String(chat || ''))) return;
  try {
    const f = activityFile(chat, home);
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const next = { ...readActivity(chat, home) };
    for (const k of FIELDS) if (Number.isFinite(patch[k])) next[k] = patch[k];
    const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(tmp, f);
  } catch { /* activity tracking must never break a send */ }
}

export const IDLE_RESET_MS = 30 * 60 * 1000;

// How many messages your agent has sent in this thread without you. `sentAt` are the timestamps of its messages in the thread.
// The run ends at the person's last action, and also after 30 quiet minutes (which is the only reset when no hook tells us about prompts).
export function turnCount({ sentAt, lastHumanAt = 0, now, idleMs = IDLE_RESET_MS }) {
  let n = 0, prev = now;
  for (const t of [...sentAt].sort((a, b) => b - a)) {
    if (t <= lastHumanAt || prev - t >= idleMs) break;
    n++; prev = t;
  }
  return n;
}

// Hop count for the next outgoing message in a thread: one more than the message it answers, if nobody stepped in since; else 1.
export function nextHop({ inboundHop = 0, inboundAt = 0, lastHumanAt = 0 }) {
  return inboundAt && lastHumanAt < inboundAt ? Math.min(inboundHop + 1, 1000) : 1;
}
