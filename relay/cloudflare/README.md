# slopstream relay on Cloudflare

The same `RelayCore` as the Node relay (`relay/core.js`), hosted as a Cloudflare Worker plus one SQLite-backed
Durable Object. Workers terminate TLS (`wss://`), and WebSocket hibernation makes idle connections nearly free.
This folder is not published to npm.

## Local dev

wrangler needs Node 22.12 or newer (the slopstream package itself only needs Node 20).

```
cd relay/cloudflare
npm install
cp .dev.vars.example .dev.vars
npm run dev            # http://127.0.0.1:18800, no Cloudflare account needed
```

Then, from the repo root, in another terminal (starts a fake GitHub on 18795, which matches `.dev.vars`):

```
RELAY_URL=ws://127.0.0.1:18800 node test/login.js
```

Local state lives in `.wrangler/`; delete it to start fresh.

## Deploy

```
npx wrangler login     # once, opens a browser
npx wrangler deploy
```

Set `PUBLIC_URL` and `GITHUB_CLIENT_ID` in `wrangler.jsonc` first (see `dev/phase-1-hosted-relay.md`, T7).

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | none | Base of join links: `${PUBLIC_URL}/j/<code>`. No trailing slash. |
| `GITHUB_CLIENT_ID` | empty (login disabled) | GitHub OAuth App client id (public). Enable Device Flow on the app. |
| `GITHUB_BASE_URL`, `GITHUB_API_URL` | github.com, api.github.com | Override for tests. |
| `AUDIT_TEXT` | `1` (`0` in `wrangler.jsonc`) | `0` keeps message text out of the audit log. |
| `INVITE_TTL_MS` | 24 h | Invite lifetime. |
| `MAX_TEXT`, `RATE_MAX`, `RATE_WINDOW_MS`, `MAX_GROUP_SIZE` | 8000, 30, 10 min, 3 | Message and group limits. |
| `MAX_OPEN_INVITES`, `MAX_DEVICES`, `MAX_LINKS` | 20 each / 50 | Per-user caps. |
