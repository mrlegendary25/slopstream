// The tool guard and prompt hooks (bridge/hook.js), and how init installs them. The hooks run as real child processes, the way Claude Code runs them.
process.env.SLOPSTREAM_KEYCHAIN = 'off';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeActivity, readActivity } from '../bridge/activity.js';
import { saveChatSettings } from '../bridge/chat-settings.js';
import { runInit, installClaudeHooks } from '../bridge/init.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'bridge/hook.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hooks-'));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

const home = path.join(TMP, 'home'); fs.mkdirSync(home, { recursive: true });
const run = (mode, input, args = ['--chat', 'c1', '--home', home]) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HOOK, mode, ...args], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  let out = null; try { out = r.stdout ? JSON.parse(r.stdout) : null; } catch { /* not JSON */ }
  return { status: r.status, out, ms: Date.now() - t0, stdout: r.stdout };
};
const asks = (r) => r.out?.hookSpecificOutput?.permissionDecision === 'ask';
const pre = (tool, tool_input, extra = {}) => run('pre-tool', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input, cwd: TMP, ...extra });

// ---- prompt hook ----
const before = Date.now();
run('prompt', { hook_event_name: 'UserPromptSubmit', prompt: 'please look at the tests' });
const a1 = readActivity('c1', home);
check('prompt hook writes lastPromptAt and lastHumanAt', a1.lastPromptAt >= before && a1.lastHumanAt >= before, JSON.stringify(a1));
rmActivity();
function rmActivity() { fs.rmSync(path.join(home, 'activity'), { recursive: true, force: true }); }
run('prompt', { prompt: '<channel source="slopstream" from="bob">hi</channel>' });
run('prompt', { prompt: "[UNTRUSTED message from bob's agent · sent by their agent. Show it to your user" });
check('prompt hook ignores a channel push', !readActivity('c1', home).lastPromptAt);
check('prompt hook output is empty (2A)', run('prompt', { prompt: 'hello' }).stdout === '');

// ---- pre-tool: guard after an inbound message ----
rmActivity();
writeActivity('c1', { lastHumanAt: 1000, lastInboundAt: 2000 }, home);
check('pre-tool: Bash after an inbound message asks', asks(pre('Bash', { command: 'ls' })));
check('pre-tool: Edit, Write, WebFetch and send_message ask too', ['Edit', 'Write', 'WebFetch', 'mcp__slopstream__send_message', 'Task', 'mcp__other__thing'].every(t => asks(pre(t, {}))));
check('pre-tool: Read, Grep, Glob and link_status never ask', ['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'mcp__slopstream__link_status'].every(t => !asks(pre(t, { file_path: '/tmp/x' }))));
writeActivity('c1', { lastHumanAt: 3000 }, home);
check('pre-tool: after a prompt (person typed since) Bash does not ask', !asks(pre('Bash', { command: 'ls' })));
check('...and the output is empty, so normal permissions apply', pre('Bash', { command: 'ls' }).stdout === '');

// ---- always-ask rules ----
writeActivity('c1', { lastHumanAt: 9e12, lastInboundAt: 1000 }, home);
check('pre-tool: a Bash command containing slopstream always asks', asks(pre('Bash', { command: 'slopstream link @bob' })) && asks(pre('Bash', { command: 'cd x && npx slopstream join abc' })) && asks(pre('Bash', { command: 'cat ~/.slopstream/config.json' })));
check('pre-tool: a command that only mentions a similar word does not', !asks(pre('Bash', { command: 'echo slopstreamer' })));
check('pre-tool: editing a file inside the slopstream home always asks', asks(pre('Edit', { file_path: path.join(home, 'chats', 'c1.json') })) && asks(pre('Read', { file_path: path.join(home, 'config.json') })) && asks(pre('Write', { file_path: '~/.slopstream/x' })));
check('pre-tool: a file outside the home is fine', !asks(pre('Edit', { file_path: path.join(TMP, 'src', 'a.js') })));
check('pre-tool: ../ tricks out of and into the home are resolved', asks(pre('Read', { file_path: path.join(TMP, 'x', '..', 'home', 'log.jsonl') })));
check('the reason says why', /confirm it yourself/.test(pre('Bash', { command: 'slopstream links' }).out.hookSpecificOutput.permissionDecisionReason));

// ---- guard off ----
writeActivity('c1', { lastHumanAt: 1000, lastInboundAt: 2000 }, home);
saveChatSettings('c1', { guard: false }, home);
check('pre-tool: guard off, no always-ask match: no output', !asks(pre('Bash', { command: 'ls' })));
check('pre-tool: guard off, the always-ask rule still applies', asks(pre('Bash', { command: 'slopstream links' })));
saveChatSettings('c1', { guard: true }, home);

// ---- missing or broken files ----
rmActivity(); fs.rmSync(path.join(home, 'chats'), { recursive: true, force: true });
check('pre-tool: missing files means no inbound, so no output', pre('Bash', { command: 'ls' }).stdout === '');
check('pre-tool: missing files do not weaken the always-ask rule', asks(pre('Bash', { command: 'slopstream links' })));
fs.mkdirSync(path.join(home, 'activity'), { recursive: true }); fs.writeFileSync(path.join(home, 'activity', 'c1.json'), 'garbage');
check('pre-tool: a damaged activity file means no inbound', pre('Bash', { command: 'ls' }).stdout === '');
check('pre-tool: garbage on stdin never crashes (exit 0, no output)', run('pre-tool', 'not json').status === 0 && run('pre-tool', 'not json').stdout === '');
check('pre-tool: no --chat and no env still works', run('pre-tool', { tool_name: 'Bash', tool_input: { command: 'ls' } }, []).status === 0);

// ---- speed ----
const times = Array.from({ length: 5 }, () => pre('Bash', { command: 'ls' }).ms).sort((a, b) => a - b);
check('hook runs in under 300 ms', times[2] < 300, times.join(','));

// ---- init ----
const proj = path.join(TMP, 'proj'); fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
const mine = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] }, permissions: { allow: ['Bash(ls)'] } };
fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify(mine, null, 2));
runInit({ chat: 'c1', agent: 'claude', cwd: proj, home });
const s1 = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8'));
const cmds = (ev) => (s1.hooks[ev] || []).flatMap(e => e.hooks.map(h => h.command));
check('init installs both hooks, with --chat and --home', cmds('PreToolUse').some(c => /hook\.js.* pre-tool --chat 'c1' --home/.test(c)) && cmds('UserPromptSubmit').some(c => /hook\.js.* prompt --chat 'c1'/.test(c)), JSON.stringify(s1.hooks));
check('init keeps the other hooks, settings and permissions', cmds('PreToolUse').includes('echo mine') && cmds('Stop').includes('echo stop') && s1.permissions.allow[0] === 'Bash(ls)');
const first = fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8');
runInit({ chat: 'c1', agent: 'claude', cwd: proj, home });
check('init is idempotent', fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8') === first);
fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), '{broken');
installClaudeHooks(proj, 'c1', {});
check('init repairs a damaged settings.local.json', JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8')).hooks.PreToolUse.length === 1);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
