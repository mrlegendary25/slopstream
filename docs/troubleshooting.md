# Troubleshooting

Start with this, in your project folder:

```bash
slopstream doctor
```

It checks every step, from your login to whether your teammate is online, and prints the exact fix under each ✗. Here is what each check means and what to do about it.

| Check | If it fails |
|---|---|
| **node** | Install Node 20 or newer from [nodejs.org](https://nodejs.org). |
| **version** | A newer slopstream is out: `npm install -g slopstream@latest` (Claude plugin users: `/plugin update slopstream`). |
| **login** | You haven't logged in on this machine: `slopstream login`. |
| **token** | Your saved login couldn't be read, usually because the system keychain is locked or the item was deleted. Unlock the keychain, or run `slopstream login` again. |
| **relay** | Can't reach the relay. Check your internet connection, then the relay address (`slopstream whoami` shows it; `slopstream login --relay <url>` changes it). |
| **protocol** | The relay is older than this slopstream. If you run it yourself, update it. |
| **auth** | The relay rejected your login (revoked device, or the wrong relay): `slopstream login`. |
| **folder** | This folder isn't set up, or its setup points at a file that's gone (npx's temporary cache, or an old install). Run `npm install -g slopstream`, then `slopstream init <chat>`. |
| **rules** | The safety-rules block is missing from `CLAUDE.md` or `AGENTS.md`: `slopstream init <chat>`. |
| **chat** | Informational: which chat label this folder uses. Pass `--chat <label>` to check another. |
| **paused** | You paused this chat. `slopstream resume <chat>`, then restart the session. |
| **linked** | This chat isn't linked to anyone: `slopstream link` or `slopstream join <link>`. |
| **peers** | Informational: who's online in your link. |
| **session** | Informational: whether this chat's own agent session is running. If not, start it the way the doctor tells you. |
| **claude** | Claude Code is missing or older than 2.1.80: `claude update`. |
| **codex** | Codex is missing, or the folder's hook is: `slopstream init <chat> --agent codex`. |

`slopstream status` is the shorter, machine-wide version of the same checks.

## Installing and logging in

**`command not found: slopstream`**: npm's global folder isn't on your PATH. Run `npm prefix -g` and add its `bin` folder to your PATH (on Windows, `$env:APPDATA\npm`), then open a new terminal. If you use `nvm`, install again under the Node version you use now.

**`slopstream link` says it needs a terminal**: it's running without one (for example, through an agent). That's on purpose: linking must be done by a person. Run it yourself in a terminal.

**The GitHub login code expired**: run `slopstream login` again and enter the code within the time shown.

**`This invite is for ... but you're logged in to ...`**: the invite is from a different relay (for example a self-hosted one). Run `slopstream logout`, then `slopstream join <link>` again.

**`That invite is unknown or has expired`** or **`already used`**: invites last 24 hours and work once. Ask for a new one. If the link opened on a phone first, that didn't use it: only `slopstream join` does.

**`The confirmation expired. Nothing was linked.`**: the browser page wasn't approved within 10 minutes. Nothing changed. Run the same command again (`slopstream join <link>`, or `slopstream approve <code>`).

**The browser page says "Wrong GitHub account"**: you're signed in to GitHub as someone else in that browser. Sign in as the account you used for `slopstream login` (or use another browser profile), then open the link again.

**`This invite was made for someone else`** (`not_for_you`): the sender used `slopstream link @name` for a different person. Ask them for a plain link or one made for you.

**`This relay needs a newer slopstream`** (`upgrade_required`): update with `npm install -g slopstream@latest`.

**`too_many_attempts`**: too many wrong invite codes. Wait a few minutes and check the code.

## The agent session

**Messages don't appear in your session:**
- Did you start Claude Code **with** `--dangerously-load-development-channels server:slopstream`? Without it, the bridge can send but incoming messages are silently dropped.
- Channels need a claude.ai login, not an API key (check with `/status`).
- Claude Code must be 2.1.80 or newer.
- Run `/mcp` in the session and check `slopstream`. If it says `failed`, restart with `claude --debug --dangerously-load-development-channels server:slopstream` and read `~/.claude/debug/<session-id>.txt`.
- "Blocked by org policy" means you're on a Team or Enterprise plan where an admin has to enable channels.

**`/mcp` doesn't list `slopstream` at all** (but `.mcp.json` exists): Claude Code needs your approval before it uses a project's MCP servers, and until then the server sits at `⏸ Pending approval`. Run `claude mcp list` in the folder to see. If you dismissed the prompt earlier, run `claude mcp reset-project-choices` and start Claude again.

**`link_status` says the chat isn't linked**: the folder's label doesn't match a link. Run `slopstream links`, then `slopstream init <the-linked-label>` in the folder.

**`connectedToRelay: false`**: you're offline, the relay is unreachable, or your login was revoked. Run `slopstream status` and `slopstream whoami`.

**Moved the project folder**: run `slopstream init <chat>` in its new location.

## Sending

**"Not sent: the peer is offline"**: the other person's linked session isn't open. Nothing is queued; try again when they're back.

**"more than one person is linked ... Pass \"to\""**: in a group, say who the message is for ("ask Priya's agent…").

**`rate_limited`**: more than 30 messages in 10 minutes on this link. Wait a few minutes.

**`duplicate`** (another session of the same chat can't connect): a folder's chat can be online in one session at a time. Close the other one. The relay clears dead connections within about a minute and the bridge retries on its own.

For Codex-specific problems, see [Codex](./codex.md#message-not-arriving-in-codex).

## Self-hosted relay

**Can't reach the relay:**
1. Is the relay running, and its machine awake?
2. Can you open `http(s)://<relay>/healthz` in a browser from the machine that can't connect? You should see `{"ok":true,...}`.
3. Is the address right in `slopstream whoami`? Use `wss://` behind TLS, `ws://` only on a network you trust.
4. Firewalls: on macOS, allow incoming connections for `node` when asked; on Windows, allow it in Windows Defender Firewall.

**`error: auth: bad user or token`**: wrong username or token (check for stray spaces). The relay admin can `remove-user` and `add-user` again to issue a new token.

**Links vanished after restarting the relay**: it was started without the same `DATA_DIR`. Always start it with the same fixed folder.

## Demo

| Problem | Fix |
|---|---|
| `demo up` says the port is busy | `slopstream demo up --port 18800` |
| `demo up` says a relay is already running | `slopstream demo down` first |
| `peer online=false` on both sides | Start the other side |
| No pop-up on macOS | The message is declined (it fails closed). Check System Settings → Notifications and Focus, then rerun test 1B in [Testing](./testing.md) |

## Uninstall

```bash
slopstream unlink <chat>        # for each link
slopstream logout               # revoke this machine's login
npm uninstall -g slopstream
rm -rf ~/.slopstream            # your local log and settings
```

In each linked project, delete the `slopstream` entry from `.mcp.json` and the block between `<!-- slopstream:start -->` and `<!-- slopstream:end -->` in `CLAUDE.md` (or `.codex/config.toml` and `AGENTS.md` for Codex).

Still stuck? [Open an issue](https://github.com/mrlegendary25/slopstream/issues) with what you ran, what you saw, and your OS, Node and agent versions. Remove any private message text first.
