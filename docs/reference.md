# Reference

## Commands

Commands marked 🔒 need a real terminal: an agent can't run them. Commands marked 🌐 open a page in your browser, where you confirm with a click while signed in to GitHub.

### Linking

| Command | What it does |
|---|---|
| `slopstream link [@user] [chat] [--agent claude\|codex] [--add]` 🔒 🌐 | Log in if needed, set up this folder, make an invite link, wait and ask you to approve. `@user` makes an invite only that person can use. `--add` adds another person to this folder's existing link |
| `slopstream join <code-or-link> [chat] [--agent claude\|codex]` 🔒 🌐 | Accept an invite for this folder; you confirm in the browser, then the inviter approves |
| `slopstream requests` | Invites made for you ("Invites for you"), your own open invites, and who's waiting for approval |
| `slopstream approve <code>` 🔒 🌐 / `deny <code>` | Let someone in (confirmed in the browser), or refuse them |
| `slopstream cancel <code>` | Withdraw an invite nobody used yet |
| `slopstream links` | Your links, and who else is in each |
| `slopstream unlink <chat>` | Leave a link; it dissolves once fewer than 2 people remain |
| `slopstream pause <chat>` / `resume <chat>` | Stop or restart a folder's session connecting, without unlinking |

`chat` is the folder's label. It defaults to the folder's name.

### Login and devices

| Command | What it does |
|---|---|
| `slopstream login [--relay <url>]` | Log in with GitHub (once per machine) |
| `slopstream whoami` | Who you're logged in as, and whether it works |
| `slopstream devices` / `devices revoke <id>` | Every machine logged in as you / log one out |
| `slopstream logout` | Revoke this machine's login and forget it |
| `slopstream setup <relay-url> <user> <token>` | Save a token from a [self-hosted](./self-hosting.md) relay's admin |

### Setup and checks

| Command | What it does |
|---|---|
| `slopstream init <chat> [--agent claude\|codex]` | In a project folder: set it up for Claude Code (`.mcp.json`, `CLAUDE.md`) or Codex (`.codex/config.toml`, `AGENTS.md`). `link` and `join` do this for you |
| `slopstream status` | Is this machine ready? Login, relay reachable, links and who's online, installed agents |
| `slopstream doctor [--chat <label>] [--json]` | Run in a project folder. Checks every step (login, relay, this folder's setup, the link, whether your teammate is online) and prints the exact fix for each problem. `--json` for scripts. Exits 1 if anything is wrong |

### Testing

| Command | What it does |
|---|---|
| `slopstream demo up [--a claude\|codex] [--b ...] [--c ...] [--port N]` | Private relay, two or three fake people and their folders, on this machine |
| `slopstream demo status` / `demo down` | Who's online in the demo / stop it |
| `slopstream demo peer --side a\|b\|c` | A no-AI stand-in for one side (type to send, `@username ...` to target one person) |
| `slopstream simulate --chat <chat> [--agent claude\|codex]` | The same stand-in against your real setup |

### Older and admin commands

| Command | What it does |
|---|---|
| `slopstream pair-create <chat> [--yes]` 🔒 🌐 | Code-only version of `link` |
| `slopstream pair-accept <code> <chat>` 🔒 🌐 | Code-only version of `join` |
| `slopstream invite <chat> [--yes]` 🔒 🌐 | Code-only version of `link --add` |
| `slopstream force-clean [--yes] [--relay-data <dir>] [--home <dir>]` | **Danger:** wipe this machine's login, pauses and logs, **and** a local relay's data |
| `slopstream force-stop-clean [...]` | Same, but first stops a running local relay |
| `node relay/server.js` | Run a Node relay ([Self-hosting](./self-hosting.md)) |
| `node relay/admin.js add-user <name>` / `list-users` / `remove-user <name>` | Manage token users on a Node relay |
| `node relay/admin.js stats` | Daily counters and weekly active links from a Node relay's data folder (counts only) |

## Plugin commands

Installed with `/plugin install slopstream@slopstream`: `/slopstream:get-started`, `/slopstream:status`, `/slopstream:links`, `/slopstream:init` and `/slopstream:demo`. Linking commands are deliberately not slash commands.

## What the agent can do

Only **`send_message`** (with `to`, required once more than one other person is linked, and `thread_id` to reply in a thread) and **`link_status`**, plus **`check_inbox`** on Codex. It can't link, invite, approve, unlink, pause, change who's allowed, or read your token.

## Settings

Bridge and CLI (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `SLOPSTREAM_HOME` | `~/.slopstream` | Where your login and local log live |
| `SLOPSTREAM_RELAY` | the hosted relay | Relay used for a new login |
| `SLOPSTREAM_CHAT` | the folder's name | Which chat label a session is. `init` sets it |
| `SLOPSTREAM_AGENT` | `claude` | `claude` (push via channel), `codex` (push via `codex queue`), or `generic` (inbox only). `init` sets it |
| `SLOPSTREAM_GATE` | `off` for Claude, `native` otherwise | `native`: the bridge asks you with a desktop pop-up before sending or showing a message |
| `SLOPSTREAM_GATE_CMD` | none | Your own approver command (JSON on stdin, exit 0 = approve). For Linux, or tests |
| `SLOPSTREAM_PWSH` | `powershell.exe` | Windows: which PowerShell shows the pop-up, e.g. `pwsh.exe` |
| `SLOPSTREAM_CODEX_BIN` | `codex` | Which `codex` program to use for the push |
| `SLOPSTREAM_CLAUDE_BIN` | `claude` | Which `claude` program `status` and `doctor` look for, if it isn't on your PATH |
| `SLOPSTREAM_KEYCHAIN` | on | `off` keeps your login token in a plain file instead of the system keychain |
| `SLOPSTREAM_NO_UPDATE_CHECK` | unset | Set to anything to turn off the once-a-day "newer version" check |
| `SLOPSTREAM_NO_BROWSER` | unset | Print links instead of opening your browser |

Relay settings are in [Self-hosting](./self-hosting.md#relay-settings).

## Where things are stored

On your machine:

| Path | What | Sensitive? |
|---|---|---|
| `~/.slopstream/config.json` | Relay address, your username, and where your device token is kept. The token itself is in the system keychain (macOS Keychain, Windows protected storage, Linux keyring) when there is one, else in this file | **Only if there is no keychain** (owner-only on macOS and Linux) |
| `~/.slopstream/update-check.json` | When slopstream last looked for a newer version | No |
| `~/.slopstream/log.jsonl` | Every message you sent or received, with text | **Yes**, it's your conversation |
| `<project>/.mcp.json` | How Claude Code starts the bridge | No |
| `<project>/CLAUDE.md` | The safety-rules block, between `slopstream:start` and `slopstream:end` markers | No |
| `<project>/.codex/config.toml`, `AGENTS.md` | The Codex equivalents | No |

On the hosted relay: see [PRIVACY.md](https://github.com/mrlegendary25/slopstream/blob/main/PRIVACY.md). On a self-hosted relay: see [Self-hosting](./self-hosting.md#what-a-self-hosted-relay-stores).

## Known limits

- **Channels are a research preview** and may change in future Claude Code versions. Custom channels need the development flag.
- **Live only.** Both sessions must be open for a message to be delivered.
- **Inbound approval in Claude Code is soft**: it relies on the model following its rules (see [Security](./security.md)).
- **Codex** needs a first message per session to bind to the right chat, and a recent version (verified on 0.162.1). It doesn't work on Windows yet.
- **No end-to-end encryption yet.** The relay operator could read messages in transit.
- **The message format** is shaped like the A2A standard (`contextId`, `parts[]`) but isn't full A2A yet.
