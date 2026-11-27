#!/usr/bin/env node
// slopstream relay: Node host.
// All protocol logic lives in relay/core.js (RelayCore). This file only provides what a host must:
// sockets (ws, on the same port as a small HTTP API), a KV store (JSON files in DATA_DIR), and a periodic sweep.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import { RelayCore, configFromEnv } from './core.js';
import { FileKV } from './kv-file.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA = path.resolve(process.env.DATA_DIR || './data');
const config = configFromEnv(process.env);
if (!config.publicUrl) config.publicUrl = `http://${HOST}:${PORT}`;
const MAX_GROUP_SIZE = config.maxGroupSize;

const core = new RelayCore({ kv: new FileKV(DATA, { auditMaxBytes: Number(process.env.AUDIT_MAX_BYTES) || undefined, auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS) || undefined }), config });

const MAX_BODY = 4096;
const server = http.createServer((req, res) => {
  const chunks = []; let size = 0; let tooBig = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { tooBig = true; return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (tooBig) { res.writeHead(413, { 'content-type': 'text/plain' }); return res.end('payload too large'); }
    try {
      const url = new URL(req.url, 'http://x');
      const out = await core.handleHttp({ method: req.method, path: url.pathname, query: url.search.slice(1), headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), ip: req.socket.remoteAddress });
      res.writeHead(out.status, out.headers || {});
      res.end(out.body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('internal error');
    }
  });
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.lastActivity = Date.now();
  const conn = {
    meta: {},
    saveMeta() {},
    send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); },
    close(c, r) { try { ws.close(c, r); } catch { /* already closing */ } },
    lastActivity: () => ws.lastActivity,
  };
  ws.on('pong', () => { ws.isAlive = true; ws.lastActivity = Date.now(); });
  ws.on('message', (raw) => { ws.lastActivity = Date.now(); core.onMessage(conn, raw.toString()); });
  ws.on('close', () => core.onClose(conn));
  core.openConn(conn, { ip: req.socket.remoteAddress });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000).unref();
setInterval(() => core.sweep(), 5000).unref();

// Pidfile, so `force-stop-clean` can find this process on any OS. The old lookup shelled out to
// `pgrep`, which only exists on Unix. Written to the data dir and to a fixed path in the home
// directory, because the CLI does not always know which DATA_DIR the relay was started with.
const PIDFILES = [path.join(DATA, 'relay.pid'), path.join(os.homedir(), '.slopstream-relay.pid')];

function writePidFiles() {
  const body = JSON.stringify({ pid: process.pid, host: HOST, port: PORT, data: DATA, startedAt: new Date().toISOString() });
  for (const f of PIDFILES) { try { fs.writeFileSync(f, body, { mode: 0o600 }); } catch { /* best effort */ } }
}

// Only remove a pidfile this process owns, so restarting does not delete a newer relay's file.
function clearPidFiles() {
  for (const f of PIDFILES) {
    try { if (JSON.parse(fs.readFileSync(f, 'utf8')).pid === process.pid) fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
}

process.on('exit', clearPidFiles);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => { clearPidFiles(); process.exit(0); }); } catch { /* not every signal exists on every OS */ }
}

server.listen(PORT, HOST, () => { writePidFiles(); console.log(`slopstream relay listening on ws://${HOST}:${PORT}  data=${DATA}  max group size=${MAX_GROUP_SIZE}`); });
