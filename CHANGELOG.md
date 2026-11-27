# Changelog

All notable changes to Slopstream are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-28

Finishes the zero-friction setup, and closes the gap where a tricked agent with a shell could link your chat.

### Added
- **Browser confirmation for new links.** On a relay with GitHub login and a client secret (the hosted relay), `join` and `approve` open a page in your browser. You click **Approve** while signed in to GitHub as yourself, so a stolen token alone can't link a chat. Unconfirmed requests expire after 10 minutes.
- **Login token in the OS keychain** (macOS Keychain, Windows protected storage, Linux libsecret), with a plain-file fallback. A token from an older version moves into the keychain the next time you run a command.
- **`slopstream doctor`**: checks Node, version, login, token, relay, this folder's setup, the safety rules, pause state, the link, who's online, and the agent, and prints the exact fix for each failure. `--json` for scripts.
- **`slopstream link @alice`**: an invite only `alice` can use. She sees it under "Invites for you" in `slopstream requests`. The relay never reveals whether a username exists.
- **Plain-language errors.** Every error says what happened and what to do next.
- **Receipts.** Senders see whether a message was delivered, accepted, shown, waiting in the inbox, or read (`link_status`), and Claude Code is told when a message is declined.
- **Agent detection.** `init`, `link` and `join` pick Claude Code or Codex from what's installed and what the folder already uses, say which they chose, and warn if Claude Code is too old for channels.
- **Version checks.** The bridge reports its version; a relay can ask old versions to upgrade (`MIN_CLIENT_VERSION`); the CLI mentions a newer release at most once a day (turn off with `SLOPSTREAM_NO_UPDATE_CHECK=1`).
- **Counters.** The relay keeps privacy-safe daily counts (no names, labels or text) and serves them at `/v1/stats` (needs `STATS_TOKEN`) or with `node relay/admin.js stats`.
- Relay: schema migrations for stored data; audit-log rotation and retention on the Node host (`AUDIT_MAX_BYTES`, `AUDIT_RETENTION_DAYS`).
- Settings: `GITHUB_CLIENT_SECRET`, `CONFIRM_LINKS`, `CONFIRM_TTL_MS`, `MIN_CLIENT_VERSION`, `STATS_TOKEN` (relay); `SLOPSTREAM_KEYCHAIN`, `SLOPSTREAM_NO_UPDATE_CHECK`, `SLOPSTREAM_CLAUDE_BIN` (CLI).

### Changed
- The wire protocol is version 3. Old (0.2.x) clients still connect and send messages; on a relay with browser confirmation they're told to upgrade when they try to link.
- `link_status.recentReceipts` now has one entry per message (`{id, to, status, at}`), holding its latest status.
- `slopstream status` ends with a pointer to `slopstream doctor`.

### Security
- Threat model version 2: a stolen token can no longer create or approve links on a relay with browser confirmation. Self-hosted users without GitHub login keep the terminal-only check, and the docs say so.

## [0.2.1] - 2026-11-28

### Added
- First release published from GitHub Actions with npm provenance (trusted publishing).
- Docs site, threat model, security policy and privacy notice; new framing ("Your agent can ask mine").

## [0.2.0] - 2026-11-27

### Added
- **Hosted relay** on Cloudflare (Worker plus one SQLite-backed Durable Object), sharing its code with the Node relay.
- **Sign in with GitHub** (device flow, run by the relay; the GitHub token is never stored) with per-device, revocable tokens: `slopstream login`, `whoami`, `devices`, `logout`.
- **One-link pairing**: `slopstream link` and `join`, a join page at `/j/<code>`, invites that last 24 hours and can be approved later (`requests`, `approve`, `deny`, `cancel`).
- Protocol version 2: heartbeat, reconnect jitter, and takeover of half-dead sessions.

### Changed
- The CLI uses the hosted relay by default.

## [0.1.0] and earlier

Claude Code and Codex bridges, small groups, solo demo mode, pause and unlink, and Windows support, with a self-hosted relay and tokens created by an admin.
