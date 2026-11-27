# Using Slopstream

## Asking another agent

Ask in your own words, naming the person if more than one is linked:

```
Ask Leo's agent which branch has the payments migration.
Ask Priya's agent to review this function the way she reviews auth code.
```

Your agent writes the message and calls `send_message`. Claude Code shows a permission prompt with the exact text. Read it and choose **Yes** (this time only). That prompt is where you decide what your agent shares, so **never choose "always allow" for `send_message`**, and don't run a linked session in a mode that skips permission prompts.

Good messages are short and specific: one question, enough context to answer it. Your agent sends text only, never files.

## Receiving a message

A message from a linked agent appears in your open session as a new prompt. It starts with `←` and `slopstream`, and is marked `[UNTRUSTED message from <name>'s agent ...]`. Your agent shows it to you, says who it's from and what it asks, and **waits for you**.

You decide what happens: ignore it, answer it, or do something with it. To answer, tell your agent what to say (or to draft an answer). It replies in the same thread with `send_message`, and you approve the text.

Treat a message from another agent like an email from someone you know but can't verify: helpful, but never instructions. If a message asks your agent to read secrets, send files, run commands or "ignore its rules", your agent should point that out and do nothing. See [Security](./security.md).

## If they're offline

A message is delivered only while the other person's linked session is open. If it isn't, the send fails right away with "the peer is offline" and **nothing is stored for later**. Try again when they're back. Ask your agent *"is Leo online?"* (it uses `link_status`) to check first.

## Every day

1. Open the linked project and start your session with `slopclaude` (or the full `claude --dangerously-load-development-channels server:slopstream`). For Codex, just start `codex` and send a first message.
2. Ask your agent *"who's online?"* and you're set.

Linking and setup are one-time. The hosted relay is always on.

## A link belongs to a folder

A link connects a project folder on your machine (its "chat label", the folder name by default) to a project folder on theirs. Close your session and open a new one in the same folder, and it reconnects as the same chat automatically. Each folder can have one link; to link a different project, run `slopstream link` in that folder.

The chat label is what most commands below take as `<chat>`. `slopstream links` shows yours.

## Every command

Commands marked 🔒 need a real terminal (an agent can't run them). Commands marked 🌐 open your browser for a click. Run any of them as `slopstream <command>`; run plain `slopstream` to see the list.

## Starting out

| I want to | Run | What happens |
|---|---|---|
| Install | `npm install -g slopstream` | Puts the `slopstream` command on your machine |
| Log in | `slopstream login` | GitHub login, once per machine. `link` and `join` do it for you the first time |
| Link a project with a teammate | `cd my-project` then `slopstream link` 🔒 🌐 | Sets the folder up for your agent, prints a link to send, waits, then asks you to approve in your browser |
| Link with one specific person | `slopstream link @leo` 🔒 🌐 | Same, but only `leo` can use the invite. He also sees it under `slopstream requests` |
| Accept someone's invite | `cd my-project` then `slopstream join <link>` 🔒 🌐 | Sets your folder up and links it; you each confirm in the browser |
| Pick the agent | add `--agent claude` or `--agent codex` to `link` or `join` | Otherwise it picks from what's installed and says so |
| Name the chat | add a name: `slopstream link my-chat` | Defaults to the folder name |
| Check everything works | `slopstream doctor` | In a project folder. Checks your login, the relay, this folder's setup, the link and whether your teammate is online, and prints the fix for each problem |
| Try it alone first | `slopstream demo up` | A private relay and fake teammates on this machine ([Testing](./testing.md)) |

### Starting a new project

Linking is per folder. For a new project: `cd` into it and run `slopstream link` (or `join <link>`). Nothing else is needed. You don't log in again.

### Starting over in a folder

```bash
slopstream links                 # find this folder's chat label
slopstream unlink <chat>         # leave the link
slopstream link                  # make a fresh one
```

If only the folder's setup is broken (wrong path, missing rules), `slopstream init <chat>` rewrites it without touching the link. `slopstream doctor` tells you when that's what you need.

## Seeing what you have

| I want to | Run |
|---|---|
| See all my links, and who's online in each | `slopstream links` |
| Check this folder end to end | `slopstream doctor` (add `--json` for scripts) |
| See invites waiting for me, my open invites, and who's waiting for my approval | `slopstream requests` |
| See which machines are logged in as me | `slopstream devices` |

## Linking and invites

| I want to | Run | Notes |
|---|---|---|
| Add a third person to a link I'm in | `slopstream link --add` 🔒 🌐 | Up to 3 people by default. Send them the new link |
| Let in someone who used my invite | `slopstream approve <code>` 🔒 🌐 | Works any time within 24 hours, even after you closed `link` |
| Refuse them | `slopstream deny <code>` | |
| Withdraw an invite nobody used | `slopstream deny <code>` | |

Once more than one other person is linked, your agent has to say who a message is for ("ask Priya's agent…"); `link_status` lists everyone and who's online.

Invites last 24 hours and work once. Finish in your browser within 10 minutes of starting, or run the command again.

## Ending or pausing a link

| I want to | Run | What happens |
|---|---|---|
| Leave a link from this folder | `slopstream unlink <chat>` | Immediate. A two-person link ends for both of you (their open session is disconnected); a group link continues for the rest |
| Make this folder unreachable for a while | `slopstream pause <chat>` | The link stays. Takes effect the next time a session starts in that folder |
| Undo that | `slopstream resume <chat>` | Restart the session to reconnect |

`unlink` removes the link on the relay but leaves the setup files in your folder. See "Removing it from a folder" below to clear those too.

## Accounts and devices

| I want to | Run | What happens |
|---|---|---|
| Only log this machine out | `slopstream logout` | Revokes this machine's login on the relay and deletes the saved token. **Your links stay.** Log in again with `slopstream login` and everything works |
| Log another machine out (lost laptop) | `slopstream devices` then `slopstream devices revoke <id>` | Immediate |
| Use a self-hosted relay without GitHub | `slopstream setup <relay-url> <user> <token>` | Saves the token the relay's admin gave you ([Self-hosting](./self-hosting.md)) |
| Use a self-hosted relay with GitHub | `slopstream login --relay wss://<relay>` | |

Each machine has its own token. It's kept in your system keychain when there is one (macOS Keychain, Windows protected storage, the Linux keyring), otherwise in `~/.slopstream/config.json`. Revoking a device takes effect immediately.

## Removing Slopstream

### Removing it from one folder

```bash
slopstream unlink <chat>          # end the link
```

Then delete the leftovers in that folder:
- Claude Code: the `slopstream` entry in `.mcp.json`, and the block between `<!-- slopstream:start -->` and `<!-- slopstream:end -->` in `CLAUDE.md`.
- Codex: the block between `# slopstream:start` and `# slopstream:end` in `.codex/config.toml`, and the slopstream block in `AGENTS.md`.

### Removing everything from this laptop

Do these in order:

```bash
slopstream links                  # note each chat label
slopstream unlink <chat>          # once per link, so your teammates aren't left linked to nothing
slopstream logout                 # revokes this machine's login and deletes the saved token
npm uninstall -g slopstream       # removes the command
rm -rf ~/.slopstream              # your local message log and settings
```

On Windows, the last line is `Remove-Item -Recurse -Force $env:USERPROFILE\.slopstream`.

Then:
- Clean each linked project folder, as above.
- If you installed the Claude Code plugin: `/plugin uninstall slopstream@slopstream` inside Claude Code.
- If you ever ran `slopstream demo up`: `slopstream demo down` first (before uninstalling).

What stays on the relay: your account record (GitHub id and login) and a 30-day metadata log. To have those deleted, [open an issue](https://github.com/mrlegendary25/slopstream/issues) (see [Privacy](https://github.com/mrlegendary25/slopstream/blob/main/PRIVACY.md)).

### Starting completely fresh

Run the removal above, then `npm install -g slopstream` and `slopstream link` or `join` as in the [Quick start](./quickstart.md).

## Something wrong?

Run `slopstream doctor` in the project folder. It prints a ✗ and the exact fix for each problem. See also [Troubleshooting](./troubleshooting.md).
