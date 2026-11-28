// Turn limit, end to end: your agent can send only maxTurns messages in one thread without a person acting.
process.env.SLOPSTREAM_KEYCHAIN = 'off';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { saveConfig } from '../bridge/config.js';
import { pairBoth } from '../bridge/net.js';
import { writeActivity } from '../bridge/activity.js';
import { saveChatSettings } from '../bridge/chat-settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'ss-turns-'));
const PORT = 18806, RELAY = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function waitFor(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(50); } return null; }
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

const dataDir = path.join(TMP, 'relay-data');
const relay = spawn('node', [path.join(ROOT, 'relay/server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, AUDIT_TEXT: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await waitFor(() => new Promise(res => relay.stdout.once('data', () => res(true))));
const addUser = (n) => execFileSync('node', [path.join(ROOT, 'relay/admin.js'), 'add-user', n], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' }).match(/token: (\S+)/)[1];
const homeA = path.join(TMP, 'a'), homeB = path.join(TMP, 'b');
const cfgA = { relay: RELAY, user: 'ta1', token: addUser('ta1') }, cfgB = { relay: RELAY, user: 'tb1', token: addUser('tb1') };
saveConfig(cfgA, homeA); saveConfig(cfgB, homeB);
await pairBoth(cfgA, 'one', cfgB, 'two');


async function startBridge(home, chat, extra = {}) {
  const pushes = [];
  const client = new Client({ name: 't', version: '0' }, { capabilities: {} });
  client.fallbackNotificationHandler = async (n) => { if (n.method === 'notifications/claude/channel') pushes.push(n.params); };
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(ROOT, 'bridge/server.js')], env: { ...process.env, SLOPSTREAM_HOME: home, SLOPSTREAM_CHAT: chat, SLOPSTREAM_NOTIFY: 'off', ...extra }, stderr: 'ignore' }));
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content[0].text }; };
  return { client, pushes, call, status: async () => JSON.parse((await call('link_status')).text) };
}
const A = await startBridge(homeA, 'one'); const B = await startBridge(homeB, 'two');
await waitFor(async () => (await A.status()).peerOnline);

let r = await A.call('send_message', { text: 'turn 1' });
const thread = /thread_id=([^,)\s]+)/.exec(r.text)?.[1];
check('first message opens a thread', !r.err && !!thread, r.text);
for (let i = 2; i <= 4; i++) { r = await A.call('send_message', { text: `turn ${i}`, thread_id: thread }); check(`message ${i} in the thread goes through`, !r.err, r.text); }
r = await A.call('send_message', { text: 'turn 5', thread_id: thread });
check('5th agent message in a thread without a human is refused', r.err && /sent 4 messages in this thread without you/.test(r.text), r.text);
check('...and the other side never got it', !B.pushes.some(p => /turn 5/.test(p.content)));
r = await A.call('send_message', { text: 'a different thread' });
check('another thread is not affected', !r.err, r.text);

writeActivity('one', { lastHumanAt: Date.now(), lastPromptAt: Date.now() }, homeA); // what the prompt hook writes when the person types
await sleep(20);
r = await A.call('send_message', { text: 'turn 5 again', thread_id: thread });
check('a prompt (activity file) resets the count', !r.err, r.text);

saveChatSettings('one', { maxTurns: 1 }, homeA);
r = await A.call('send_message', { text: 'one more', thread_id: thread });
r = await A.call('send_message', { text: 'and another', thread_id: thread });
check('maxTurns comes from the chat settings file', r.err && /sent 1 messages/.test(r.text), r.text);

await A.client.close(); await B.client.close(); relay.kill();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
