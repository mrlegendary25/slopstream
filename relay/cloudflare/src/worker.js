// Cloudflare host for RelayCore: one Durable Object named "global" holds all state and every socket,
// the same model as the single Node process. Hibernation keeps idle connections nearly free.
import { DurableObject } from 'cloudflare:workers';
import { RelayCore, configFromEnv } from '../../core.js';
import { SqlKV } from './sqlkv.js';

export default {
  async fetch(request, env) {
    return env.RELAY.get(env.RELAY.idFromName('global')).fetch(request); // all HTTP + WS go to one object
  },
};

export class RelayDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.byWs = new WeakMap();
    this.core = new RelayCore({ kv: new SqlKV(ctx.storage.sql), config: configFromEnv(env) });
    // Answer heartbeats without waking the object (exact string match).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    // Re-register every socket that survived hibernation, so sweep() still sees unauthenticated ones
    // and sessions are back in core.online.
    for (const ws of ctx.getWebSockets()) this.core.restoreConn(this.conn(ws));
  }

  conn(ws) {
    let c = this.byWs.get(ws);
    if (!c) {
      const ctx = this.ctx;
      c = {
        meta: ws.deserializeAttachment() || {},
        saveMeta() { ws.serializeAttachment(this.meta); },
        send(o) { try { ws.send(JSON.stringify(o)); } catch { /* socket gone */ } },
        close(code, reason) { try { ws.close(code, reason); } catch { /* already closed */ } },
        lastActivity() {
          const auto = ctx.getWebSocketAutoResponseTimestamp(ws);
          return Math.max(this.meta.lastMsgAt || this.meta.openedAt || 0, auto ? auto.getTime() : 0);
        },
      };
      this.byWs.set(ws, c);
    }
    return c;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (request.headers.get('upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      this.core.openConn(this.conn(server), { ip });
      await this.ensureAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    const body = request.method === 'POST' ? (await request.text()).slice(0, 4096) : '';
    const r = await this.core.handleHttp({ method: request.method, path: url.pathname, body, ip });
    if (this.core.hasPendingState()) await this.ensureAlarm();
    return new Response(r.body, { status: r.status, headers: r.headers });
  }

  async webSocketMessage(ws, message) {
    const c = this.conn(ws);
    c.meta.lastMsgAt = Date.now(); // in memory only; persisted whenever the core calls saveMeta() for another reason
    this.core.onMessage(c, typeof message === 'string' ? message : new TextDecoder().decode(message));
    await this.ensureAlarm();
  }
  async webSocketClose(ws, code, reason) { this.core.onClose(this.conn(ws)); try { ws.close(code, reason); } catch { /* already closed */ } }
  async webSocketError(ws) { this.core.onClose(this.conn(ws)); }

  async ensureAlarm() { if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 30000); }
  async alarm() {
    this.core.sweep();
    const busy = this.ctx.getWebSockets().length > 0 || this.core.hasPendingState();
    if (busy) await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
}
