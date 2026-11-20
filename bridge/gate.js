// Human approval gate: the bridge itself asks the human before a message goes out or comes in.
// This does not depend on the agent's own UI (Claude Code / Codex permission prompts), so it is the
// same hard guarantee for every agent. It FAILS CLOSED: if it can't ask, the answer is "no".
//
//   SLOPSTREAM_GATE=off|native      (default: off for Claude Code, native for Codex/other)
//   SLOPSTREAM_GATE_CMD=<command>   custom approver (used by tests and non-macOS). Receives JSON on stdin
//                                   {kind, peer, text}; exit code 0 = approve, anything else = decline.
//
// "native" = a macOS dialog via osascript. The message text is passed as an argument, never spliced
// into the AppleScript source, so a hostile message cannot inject script code.

import { spawn } from 'node:child_process';

const MAX_SHOWN = 1500;
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const clean = (s) => String(s).replace(CTRL, '');
const shorten = (s) => { const t = clean(s); return t.length > MAX_SHOWN ? t.slice(0, MAX_SHOWN) + `\n\n[... ${t.length - MAX_SHOWN} more characters not shown]` : t; };

const DIALOG_SCRIPT = (secs) => [
  'on run argv',
  '  set theText to item 1 of argv',
  '  set theTitle to item 2 of argv',
  '  set noLabel to item 3 of argv',
  '  set yesLabel to item 4 of argv',
  '  tell current application to activate',
  '  try',
  `    set r to display dialog theText with title theTitle buttons {noLabel, yesLabel} default button noLabel cancel button noLabel with icon caution giving up after ${secs}`,
  '    if gave up of r then return "timeout"',
  '    return "approved"',
  '  on error number -128',
  '    return "declined"',
  '  end try',
  'end run',
];

function runOsascript(args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let p;
    try { p = spawn('osascript', args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return finish({ ok: false, out: '', error: e.message }); }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish({ ok: false, out, error: 'timeout' }); }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += ''; });
    p.on('error', (e) => { clearTimeout(t); finish({ ok: false, out, error: e.message }); });
    p.on('close', (code) => { clearTimeout(t); finish({ ok: code === 0, out: out.trim(), error: code === 0 ? null : `osascript exit ${code}` }); });
  });
}

function runCmd(cmd, payload, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let p;
    try { p = spawn(cmd, { shell: true, stdio: ['pipe', 'ignore', 'inherit'] }); } catch (e) { return finish({ approved: false, via: 'cmd', reason: `could not run approver: ${e.message}` }); }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish({ approved: false, via: 'cmd', reason: 'timeout' }); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); finish({ approved: false, via: 'cmd', reason: `could not run approver: ${e.message}` }); });
    p.on('close', (code) => { clearTimeout(t); finish(code === 0 ? { approved: true, via: 'cmd' } : { approved: false, via: 'cmd', reason: code === null ? 'killed' : `approver exit ${code}` }); });
    p.stdin.on('error', () => {});
    p.stdin.end(JSON.stringify(payload));
  });
}

export function makeGate({ mode = 'off', cmd = '', timeoutSec = 120 } = {}) {
  let chain = Promise.resolve(); // one dialog at a time, in arrival order

  async function run(req) {
    const peer = clean(req.peer || 'your friend');
    const text = shorten(req.text || '');
    if (cmd) return runCmd(cmd, { kind: req.kind, peer, text: clean(req.text || '') }, (timeoutSec + 10) * 1000);
    if (process.platform !== 'darwin') {
      return { approved: false, via: 'unavailable', reason: 'native approval pop-ups only work on macOS. Set SLOPSTREAM_GATE_CMD to your own approver, or SLOPSTREAM_GATE=off to rely on the agent\'s own permission prompts.' };
    }
    const outbound = req.kind === 'outbound';
    const body = outbound
      ? `Your agent wants to send this message to ${peer}'s agent:\n\n${text}\n\nSend it?`
      : `${peer}'s agent sent this message (untrusted text from another AI agent):\n\n${text}\n\nLet your agent see it?`;
    const title = outbound ? 'Slopstream: approve outgoing message' : 'Slopstream: approve incoming message';
    const args = [];
    for (const line of DIALOG_SCRIPT(timeoutSec)) args.push('-e', line);
    args.push(body, title, outbound ? "Don't send" : 'Decline', outbound ? 'Send' : 'Show to my agent');
    const r = await runOsascript(args, (timeoutSec + 15) * 1000);
    if (!r.ok) return { approved: false, via: 'native', reason: `could not show the approval dialog (${r.error})` };
    return r.out === 'approved' ? { approved: true, via: 'native' } : { approved: false, via: 'native', reason: r.out || 'declined' };
  }

  return {
    mode,
    ask(req) {
      if (mode === 'off') return Promise.resolve({ approved: true, via: 'off' });
      const p = chain.then(() => run(req)).catch((e) => ({ approved: false, via: 'error', reason: String(e && e.message || e) }));
      chain = p.then(() => {}, () => {});
      return p;
    },
  };
}

// Best-effort, non-blocking macOS notification (used only when the gate is off and the agent has no push).
// Set SLOPSTREAM_NOTIFY=off to silence these entirely (tests always do this; a real user can too).
export function notify(title, text) {
  if (process.platform !== 'darwin' || process.env.SLOPSTREAM_NOTIFY === 'off') return;
  try {
    const p = spawn('osascript', ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', shorten(text).slice(0, 200), clean(title)], { stdio: 'ignore' });
    p.on('error', () => {});
  } catch { /* never break the bridge over a notification */ }
}
