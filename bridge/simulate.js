// `slopstream simulate --chat <chat> --agent claude|codex`: a stand-in for Claude Code / Codex that
// needs NO AI and costs nothing. It starts the real bridge exactly as the agent would, lets you type
// messages to send, and prints what arrives. Use it to test the plumbing: relay, pairing, delivery,
// presence, approval pop-ups.
//
// Uses the SLOPSTREAM_HOME of the environment it runs in, like the real bridge does.
import readline from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SERVER_PATH } from './init.js';

export async function runSimulate({ chat, agent = 'claude', linger }) {
  agent = String(agent).toLowerCase();
  const push = agent === 'claude';
  const out = (s) => console.log(s);
  const client = new Client({ name: 'slopstream-simulate', version: '0' }, { capabilities: {} });
  let lastThread = null;

  client.fallbackNotificationHandler = async (n) => {
    if (n.method !== 'notifications/claude/channel') return;
    lastThread = n.params?.meta?.thread_id || lastThread;
    out(`\n<-- [channel push] from ${n.params?.meta?.from} (thread ${n.params?.meta?.thread_id}):\n${n.params?.content}\n`);
  };

  const transport = new StdioClientTransport({
    command: 'node', args: [SERVER_PATH], stderr: 'pipe',
    env: { ...process.env, SLOPSTREAM_CHAT: chat, SLOPSTREAM_AGENT: agent },
  });
  await client.connect(transport);
  transport.stderr?.on('data', (d) => String(d).split('\n').filter(Boolean).forEach(l => out(`    [bridge] ${l.replace(/^\[slopstream\] /, '')}`)));

  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content?.[0]?.text ?? '' }; };
  out(`simulating a ${agent} agent on chat "${chat}" (${push ? 'messages are pushed in' : 'approved messages wait in the inbox; this simulator checks it every second'}).`);
  out('type a message and press Enter to send it (use "@username message" to target one peer in a group).  /status  /inbox  /quit\n');

  let poll = null;
  if (!push) {
    poll = setInterval(async () => {
      try {
        const r = await call('check_inbox');
        if (!r.err && r.text !== 'Inbox empty.') {
          const m = r.text.match(/thread_id=([A-Za-z0-9._-]+)/); if (m) lastThread = m[1];
          out(`\n<-- [inbox] ${r.text}\n`);
        }
      } catch { /* bridge closing */ }
    }, 1000);
  }

  let closing = false;
  const finish = async () => {
    if (closing) return; closing = true;
    if (poll) clearInterval(poll);
    try { await client.close(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', finish);

  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    chain = chain.then(async () => {
      const t = line.trim(); if (!t) return;
      if (t === '/quit' || t === '/exit') return finish();
      if (t === '/status') { out((await call('link_status')).text); return; }
      if (t === '/inbox') { if (push) out('(this agent is push-based; there is no inbox)'); else out((await call('check_inbox')).text); return; }
      let to, body = t;
      const m = t.match(/^@(\S+)\s+([\s\S]+)$/);
      if (m) { to = m[1]; body = m[2]; }
      const r = await call('send_message', { text: body, ...(to ? { to } : {}), ...(lastThread ? { thread_id: lastThread } : {}) });
      out(`--> ${r.err ? 'NOT SENT: ' : ''}${r.text}`);
    });
  });
  rl.on('close', () => {
    // Piped input finished (scripts/tests): wait a moment for replies, then leave.
    const wait = Number.isFinite(linger) ? linger : (process.stdin.isTTY ? 0 : 2500);
    chain.then(() => setTimeout(finish, wait));
  });
}
