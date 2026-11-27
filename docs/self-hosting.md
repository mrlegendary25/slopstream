# Self-hosting

You don't need this to use Slopstream: the hosted relay is free and always on. Run your own relay if your company wants traffic on its own infrastructure, you want full control of what's stored, or you're developing Slopstream itself.

The relay is the same code everywhere (`relay/core.js`), with two hosts:

| | Your own Cloudflare relay | Node relay |
|---|---|---|
| Best for | A team, or anyone reachable over the internet | Your own server, an office network, development |
| TLS (`wss://`) | Built in | Bring a reverse proxy, or keep it on a network you trust |
| Always on | Yes | While your machine or server runs |
| Accounts | GitHub login | GitHub login, or tokens you create |
| Cost | Cloudflare's free plan is enough for a small team | Whatever the machine costs |

Whichever you pick, people use the same commands as on the hosted relay: `slopstream link` and `slopstream join`.

## Option A: your own Cloudflare relay

You need a Cloudflare account, a GitHub account, and **Node 22.12 or newer** for Cloudflare's `wrangler` tool (Slopstream itself only needs Node 20).

**1. Create a GitHub OAuth App** (this is how people log in):

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Name it (for example "Acme Slopstream"). For **Homepage URL**, put your future relay URL (for example `https://acme-slopstream.<your-subdomain>.workers.dev`). For **Authorization callback URL**, put that URL followed by `/v1/auth/github/callback`.
3. Tick **Enable Device Flow**, and register.
4. Copy the **Client ID**. It's public.
5. Click **Generate a new client secret** and copy it. It's private. You need it for [browser confirmation](#github-login-and-browser-confirmation); without it, login still works but new links are approved in the terminal.

**2. Configure and deploy:**

```bash
git clone https://github.com/mrlegendary25/slopstream.git
cd slopstream/relay/cloudflare
npm ci
```

Edit `wrangler.jsonc`:

- `"name"`: your Worker's name, for example `acme-slopstream`.
- `vars.PUBLIC_URL`: your relay's URL, with no trailing slash. Join links are built from it.
- `vars.GITHUB_CLIENT_ID`: the Client ID from step 1.
- Leave `AUDIT_TEXT` at `"0"` so message text is never written to the audit log.

```bash
npx wrangler login     # once; opens a browser
npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the client secret from step 1
npx wrangler deploy
```

**3. Check it:** open `https://<your-relay>/v1/info`. You should see `"protocol":3` and, if you set the secret, `"confirmLinks":true`.

**4. Use it.** Each person logs in to your relay once:

```bash
slopstream login --relay wss://<your-relay>
```

Then link exactly as in the [Quick start](./quickstart.md). Someone who isn't logged in anywhere yet can skip the login: `slopstream join <link>` picks up the relay from the link. To make your relay the default for new logins on a machine, set `SLOPSTREAM_RELAY=wss://<your-relay>`.

To try the Cloudflare host locally without an account, see [`relay/cloudflare/README.md`](https://github.com/mrlegendary25/slopstream/blob/main/relay/cloudflare/README.md).

## Option B: a Node relay

**1. Get the code and start the relay:**

```bash
git clone https://github.com/mrlegendary25/slopstream.git
cd slopstream
npm ci
HOST=127.0.0.1 PORT=8787 DATA_DIR="$HOME/.slopstream-relay" AUDIT_TEXT=0 node relay/server.js
```

```
slopstream relay listening on ws://127.0.0.1:8787  data=/Users/you/.slopstream-relay  max group size=3
```

- **Always use the same `DATA_DIR`.** It holds users, links and the audit log. Start the relay from a different folder without it and your links seem to vanish.
- **`AUDIT_TEXT=0`** keeps message text out of the audit log. The Node relay's default is `1` (text is logged).
- **Keep the machine awake.** On macOS, put `caffeinate -i` before `node`. On Windows, see [Windows](./windows.md).
- In PowerShell, set each variable first (`$env:HOST = "127.0.0.1"` and so on), then run `node relay/server.js` in the same window.

**2. Make it reachable.** Pick one:

- **Over the internet (recommended for teams):** keep `HOST=127.0.0.1` and put a TLS reverse proxy in front. With [Caddy](https://caddyserver.com), which gets the certificate for you:
  ```bash
  caddy reverse-proxy --from relay.example.com --to 127.0.0.1:8787
  ```
  Start the relay with `PUBLIC_URL=https://relay.example.com`. People connect to `wss://relay.example.com`.
- **On a network everyone is already on** (an office network or a company VPN): set `HOST` to this machine's address on that network and `PUBLIC_URL=http://<that-address>:8787`. People connect to `ws://<that-address>:8787`. This traffic isn't encrypted, so only do this on a network you trust.
- **Just this machine:** the default `HOST=127.0.0.1`. Useful for development. For a quick solo test, `slopstream demo up` does all of this for you (see [Testing](./testing.md)).

::: danger Never expose plain ws:// to the internet
Device tokens and message text would travel unencrypted. Use TLS (`wss://`) for anything that leaves a network you trust.
:::

**3. Accounts.** Pick one:

- **GitHub login:** create an OAuth App as in Option A and start the relay with `GITHUB_CLIENT_ID=<client-id>` and `GITHUB_CLIENT_SECRET=<client-secret>`. Everyone runs `slopstream login --relay <relay-url>`.
- **Tokens you create (no GitHub):** from the Slopstream folder, for each person:
  ```bash
  DATA_DIR="$HOME/.slopstream-relay" node relay/admin.js add-user leo
  ```
  It prints a token **once** (the relay stores only a hash). Send it to that person privately. They run:
  ```bash
  slopstream setup wss://relay.example.com leo <token>
  ```
  Lost or leaked token: `node relay/admin.js remove-user leo`, then `add-user leo` again. `list-users` shows everyone.

**4. Link.** Exactly as in the [Quick start](./quickstart.md): `slopstream link`, send the link, `slopstream join <link>`, approve.

## GitHub login and browser confirmation

With GitHub login **and** a client secret, the relay asks each person to confirm a new link with a click in their browser, signed in to GitHub as themselves (see [Security](./security.md#linking-needs-you-in-your-browser)). This is what stops a program that has read someone's saved login from linking their chat.

- The OAuth App's **Authorization callback URL** must be `<PUBLIC_URL>/v1/auth/github/callback`, and `PUBLIC_URL` must be the address people really use.
- `CONFIRM_LINKS=auto` (the default) turns it on when both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set. `on` requires it (the relay refuses to start without the secret); `off` never asks.
- An unconfirmed request expires after `CONFIRM_TTL_MS` (10 minutes).
- **Users created with `admin.js add-user` (no GitHub) don't get browser confirmation.** There's no second identity to confirm with, so they keep the terminal-only check, which an agent with a shell can bypass using a stolen token. Use GitHub login if that matters to you.
- The relay uses the GitHub sign-in once, to learn who is at the keyboard. It never stores the GitHub token.

## Relay settings

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Node only. Address to listen on |
| `PORT` | `8787` | Node only. Port (HTTP and WebSocket share it) |
| `DATA_DIR` | `./data` | Node only. Where users, links, state and the audit log live. **Set it to a fixed folder** |
| `PUBLIC_URL` | `http://HOST:PORT` (Node) | Base of join links: `${PUBLIC_URL}/j/<code>`. No trailing slash |
| `GITHUB_CLIENT_ID` | empty (GitHub login off) | GitHub OAuth App client ID, with Device Flow enabled |
| `GITHUB_CLIENT_SECRET` | empty | The OAuth App's client secret. Needed for browser confirmation. On Cloudflare set it with `wrangler secret put`, never in `wrangler.jsonc` |
| `CONFIRM_LINKS` | `auto` | `auto`: on when the client ID and secret are set. `on`: required. `off`: never |
| `CONFIRM_TTL_MS` | `600000` | How long a browser confirmation stays open (10 minutes) |
| `MIN_CLIENT_VERSION` | empty | Refuse clients older than this (they're told to upgrade). Leave empty until you've announced it: setting it cuts off everyone on an older version, including their open sessions |
| `STATS_TOKEN` | empty (stats off) | Turns on `GET /v1/stats` for people who send `Authorization: Bearer <STATS_TOKEN>`. On Cloudflare set it with `wrangler secret put` |
| `AUDIT_MAX_BYTES` / `AUDIT_RETENTION_DAYS` | `10485760` / `30` | Node: when `audit.jsonl` is rotated, and how many days rotated files are kept. Cloudflare: only the retention applies
| `AUDIT_TEXT` | `1` (`0` in `wrangler.jsonc`) | `0` keeps message text out of the audit log |
| `MAX_TEXT` | `8000` | Max characters per message |
| `MAX_GROUP_SIZE` | `3` | How many people one link can hold |
| `RATE_MAX` / `RATE_WINDOW_MS` | `30` / `600000` | Max messages per link per window (10 minutes) |
| `INVITE_TTL_MS` | `86400000` | How long an invite lasts (24 hours) |
| `MAX_OPEN_INVITES` / `MAX_DEVICES` / `MAX_LINKS` | `20` / `20` / `50` | Per-person caps |

## What a self-hosted relay stores

| Where | What |
|---|---|
| `users.json` (Node) | Users and **hashed** tokens |
| `links.json` (Node) | Who is linked to whom |
| `state.json` (Node) | Devices (hashed tokens), invites, GitHub account mapping |
| `audit.jsonl` (Node) | Events (logins, links, who messaged whom), plus message text unless `AUDIT_TEXT=0`. Rotated at `AUDIT_MAX_BYTES`; rotated files are deleted after `AUDIT_RETENTION_DAYS` |
| Daily counters | Counts per day (logins, new accounts, invites, links, messages, undelivered, first messages) and the ids of links that were active, kept 90 days. No names, labels or text. Read them with `node relay/admin.js stats` (Node) or `/v1/stats` (see `STATS_TOKEN`) |
| Durable Object storage (Cloudflare) | The same records in SQLite. Audit entries older than `AUDIT_RETENTION_DAYS` (30 by default) are deleted automatically |

Whoever runs the relay can read messages as they pass through (end-to-end encryption is on the roadmap). Self-hosting means that person is you. See the [threat model](https://github.com/mrlegendary25/slopstream/blob/main/THREAT_MODEL.md).

## Stopping and removing

- **Node:** Ctrl+C in the relay's window. To delete everything: `rm -rf ~/.slopstream-relay`.
- **Cloudflare:** `npx wrangler delete` from `relay/cloudflare`, then delete the OAuth App on GitHub.

To reset this machine to zero, run `slopstream logout` and delete `~/.slopstream`.
