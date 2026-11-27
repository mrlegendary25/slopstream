// Group (>2 person) tests: invite, targeted send_message ("to"), ambiguous-target refusal,
process.env.SLOPSTREAM_KEYCHAIN = 'off'; // tests must never touch the real keychain (children inherit this)
// receipts routed to the right sender only, MAX_GROUP_SIZE enforcement, and leaving a group.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { admin, nextMsg, pairBoth, inviteAndAccept } from '../bridge/net.js';
import { saveConfig } from '../bridge/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'ss-group-'));
const PORT = 18792;
const RELAY = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function waitFor(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(50); } return null; }

const dataDir = path.join(TMP, 'relay-data');
const relay = spawn('node', [path.join(ROOT, 'relay/server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, MAX_GROUP_SIZE: '3' }, stdio: ['ignore', 'pipe', 'inherit'] });
await waitFor(() => new Promise(res => relay.stdout.once('data', () => res(true))));

const addUser = (n) => execFileSync('node', [path.join(ROOT, 'relay/admin.js'), 'add-user', n], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' }).match(/token: (\S+)/)[1];
const homeFor = (n) => path.join(TMP, 'home-' + n);
const cfg = {};
for (const n of ['himnish', 'aarush', 'maya', 'nandan']) { cfg[n] = { relay: RELAY, user: n, token: addUser(n) }; saveConfig(cfg[n], homeFor(n)); }

async function unlinkChat(c, chat) {
  const ws = await admin(c);
  ws.send(JSON.stringify({ t: 'unlink', chat }));
  await nextMsg(ws, ['unlinked_ok'], 5000);
  ws.close();
}

async function startBridge(user, chat) {
  const inbox = [];
  const client = new Client({ name: 'test-' + user, version: '0' }, { capabilities: {} });
  client.fallbackNotificationHandler = async (n) => { if (n.method === 'notifications/claude/channel') inbox.push(n.params); };
  const transport = new StdioClientTransport({ command: 'node', args: [path.join(ROOT, 'bridge/server.js')], env: { ...process.env, SLOPSTREAM_HOME: homeFor(user), SLOPSTREAM_CHAT: chat }, stderr: 'ignore' });
  await client.connect(transport);
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content[0].text }; };
  return { client, inbox, call, status: async () => JSON.parse((await call('link_status')).text) };
}

// 1. pair himnish <-> aarush, then aarush invites maya into the SAME group.
await pairBoth(cfg.himnish, 'projX', cfg.aarush, 'projX');
const link = await inviteAndAccept(cfg.aarush, 'projX', cfg.maya, 'projX');
check('invite adds a third member to the existing link', !!link?.id);

const H = await startBridge('himnish', 'projX');
const A = await startBridge('aarush', 'projX');
const M = await startBridge('maya', 'projX');

await waitFor(async () => (await H.status()).peers.length === 2);
await waitFor(async () => (await A.status()).peers.length === 2);
await waitFor(async () => (await M.status()).peers.length === 2);
const hStatus = await H.status(); const aStatus = await A.status(); const mStatus = await M.status();
check('himnish sees aarush and maya, both online', hStatus.peers.length === 2 && hStatus.peers.every(p => p.online) && hStatus.peers.map(p => p.user).sort().join() === 'aarush,maya', JSON.stringify(hStatus.peers));
check('aarush sees himnish and maya, both online', aStatus.peers.length === 2 && aStatus.peers.every(p => p.online), JSON.stringify(aStatus.peers));
check('maya sees himnish and aarush, both online', mStatus.peers.length === 2 && mStatus.peers.every(p => p.online), JSON.stringify(mStatus.peers));

// 2. sending without "to" when more than one peer is linked is refused with a clear reason
let r = await H.call('send_message', { text: 'who gets this?' });
check('ambiguous send without "to" is refused', r.err && /more than one person/.test(r.text), r.text);

// 3. targeted send_message reaches only the named peer, not the whole group
r = await H.call('send_message', { text: 'hello maya specifically', to: 'maya' });
check('targeted send to maya delivered', !r.err && /Delivered/.test(r.text), r.text);
const gotM = await waitFor(() => M.inbox[0]);
check('maya received it, framed as untrusted', !!gotM && /UNTRUSTED message from himnish/.test(gotM.content || ''), gotM?.content);
await sleep(300);
check('aarush did NOT receive it (targeted, not broadcast)', A.inbox.length === 0, JSON.stringify(A.inbox));

// 4. reply from maya back to himnish, same thread, also targeted
const thread = gotM.meta.thread_id;
r = await M.call('send_message', { text: 'got it, thanks', to: 'himnish', thread_id: thread });
check('maya -> himnish delivered', !r.err, r.text);
const back = await waitFor(() => H.inbox[0]);
check('reply reaches himnish on the same thread', back?.meta?.thread_id === thread && back?.meta?.from === 'maya');

// 5. receipts route back to the correct original sender only
await waitFor(async () => (await H.status()).recentReceipts.some(x => x.status === 'accepted' && x.to === 'maya'));
check('himnish got an accept receipt from maya', (await H.status()).recentReceipts.some(x => x.to === 'maya'));
check('aarush got no receipt for a message it was never part of', (await A.status()).recentReceipts.length === 0, JSON.stringify((await A.status()).recentReceipts));

// 6. group is full (MAX_GROUP_SIZE=3): a 4th person cannot be invited
try {
  await inviteAndAccept(cfg.himnish, 'projX', cfg.nandan, 'projX');
  check('4th invite is rejected (group_full)', false, 'invite unexpectedly succeeded');
} catch (e) {
  check('4th invite is rejected (group_full)', e.code === 'group_full', e.message);
}

// 7. aarush leaves: himnish and maya stay linked to each other; aarush is cut off, not queued/kept
await unlinkChat(cfg.aarush, 'projX');
await sleep(500);
const aAfter = await A.status();
check('the leaver is now unlinked', !aAfter.connectedToRelay && /unlinked/.test(aAfter.problem || ''), JSON.stringify(aAfter));
const hAfter = await H.status(); const mAfter = await M.status();
check('himnish and maya remain linked to each other after aarush leaves', hAfter.peers.length === 1 && hAfter.peers[0].user === 'maya' && hAfter.peers[0].online, JSON.stringify(hAfter.peers));
check('maya still sees himnish linked', mAfter.peers.length === 1 && mAfter.peers[0].user === 'himnish' && mAfter.peers[0].online, JSON.stringify(mAfter.peers));

// 8. down to 2 members: leaving now dissolves the whole link, same as the classic 2-person case
await unlinkChat(cfg.himnish, 'projX');
await sleep(500);
const mFinal = await M.status();
check('link dissolves once it would drop below 2 members', !mFinal.connectedToRelay && /unlinked/.test(mFinal.problem || ''), JSON.stringify(mFinal));

await H.client.close(); await A.client.close(); await M.client.close(); relay.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
