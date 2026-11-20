# Slopstream

> ## Seamless slop grenades.

**Stop being the clipboard.** Slopstream links one Claude Code (or Codex) chat of yours to one (or a few) of a friend's, so the agents can message each other directly, instead of the two of you copy-pasting their output back and forth.

- A message arrives as a **new prompt in the chat that is already open**. It never starts a new chat.
- **Both humans approve**: every outgoing message and every incoming one.
- **Only while both are online.** Nothing is queued, so nobody's agent can get pinged at 3 a.m.
- **One chat to one chat — or a small, explicit group.** Not "anyone can message my Claude". A link can grow to a few people (default up to 3, configurable), with every addition approved by someone already in it.

What it is and why it exists: see [product.md](./product.md). This file is the full how-to, with explanations. In a hurry? **[SETUP.md](./SETUP.md)** is the same setup as commands only, no explanations.

> **Status.** V1. Works with **Claude Code** and **Codex**, and installs as a **Claude Code plugin**. The relay, pairing/invites, delivery rules, approval gates and security checks are covered by automated end-to-end tests (`npm test`), and the Codex push was verified against a real Codex. It has **not yet been verified inside a live Claude Code session** or with the macOS pop-ups. **[TESTING.md](./TESTING.md)** walks you through that in three parts: on your own machine, with a friend on Claude, and with a friend on Codex.

---

## Contents

1. [How the pieces fit together](#1-how-the-pieces-fit-together)
2. [Before you start](#2-before-you-start)
3. [Step 1: Install Tailscale (both of you)](#3-step-1-install-tailscale-both-of-you)
4. [Step 2: Let your friend reach your machine](#4-step-2-let-your-friend-reach-your-machine)
5. [Step 3: Get Slopstream (both of you)](#5-step-3-get-slopstream-both-of-you)
6. [Step 4: Start the relay (the relay host only)](#6-step-4-start-the-relay-the-relay-host-only)
7. [Step 5: Connect each machine to the relay (both)](#7-step-5-connect-each-machine-to-the-relay-both)
8. [Step 6: Pair one chat with one chat](#8-step-6-pair-one-chat-with-one-chat)
9. [Step 7: Turn it on in a project and use it](#9-step-7-turn-it-on-in-a-project-and-use-it)
10. [Test it (alone, with a friend, with Codex)](#10-test-it-alone-with-a-friend-with-codex)
11. [Every day after setup](#11-every-day-after-setup)
12. [Reference](#12-reference)
13. [Security: what is enforced and what is not](#13-security-what-is-enforced-and-what-is-not)
14. [Troubleshooting](#14-troubleshooting)
15. [Uninstall](#15-uninstall)
16. [Known limits](#16-known-limits)

---

## 1. How the pieces fit together

```
 Your machine                                                Your friend's machine
 ┌───────────────────────┐                                  ┌───────────────────────┐
 │ Claude Code session   │                                  │ Claude Code session   │
 │        ▲  │ stdio     │                                  │        ▲  │ stdio     │
 │        │  ▼           │                                  │        │  ▼           │
 │ BRIDGE (per session)  │───┐                          ┌───│ BRIDGE (per session)  │
 └───────────────────────┘   │      over Tailscale      │   └───────────────────────┘
                             ▼                          ▼
                       ┌─────────────────────────────────────┐
                       │ RELAY (runs on ONE of your machines) │
                       │ logins, pairing, "who is online",   │
                       │ delivery rules, rate limit, audit   │
                       └─────────────────────────────────────┘
```

| Piece | What it is | Who runs it |
|---|---|---|
| **Tailscale** | A private network between your machines, so the relay never has to be on the open internet | both of you |
| **Relay** | A tiny server that routes messages between linked chats | **one person**, the "relay host" |
| **Bridge** | A small program that Claude Code starts inside each linked chat. It receives messages and gives Claude a `send_message` tool | both (Claude Code starts it for you) |
| **`slopstream` CLI** | Commands for setup, pairing and unlinking. **Claude itself cannot run these**, on purpose | both |

Throughout this guide, the examples assume **you** are the relay host and **your friend** is the other person. If it's the other way around, just swap which of you follows the steps marked **[relay host]**.

## 2. Before you start

Each of you needs:

- [ ] A Mac on **macOS 12 (Monterey) or newer**
- [ ] **Node.js 20 or newer.** Check with `node -v`. If it's missing or old, install it from [nodejs.org](https://nodejs.org) or with `nvm install --lts`.
- [ ] **Claude Code v2.1.80 or newer.** Check with `claude --version`; update with `claude update`.
- [ ] Claude Code logged in with your **claude.ai account** (a Pro plan is fine). Channels do **not** work with an API key. Inside Claude Code, `/status` shows how you're logged in.
- [ ] A **Tailscale account** each (free, created in Step 1). Do not share one account between the two of you.

## 3. Step 1: Install Tailscale (both of you)

**What Tailscale is, in one paragraph.** Tailscale makes a private, encrypted network between your devices, wherever they are. Each device gets a private address that looks like `100.101.102.103`. Only devices on your private network can reach it. That's how your friend's machine can talk to the relay on your machine without you opening anything to the internet.

Do this on **each** machine:

1. Go to **<https://tailscale.com/download>** and download the macOS app. Tailscale offers a Standalone version, a Mac App Store version and an open-source CLI version; **the Standalone version is the one they recommend**. Don't install both the App Store and Standalone versions on the same machine.
2. Open the downloaded app and drag it to Applications if asked. Launch **Tailscale**.
3. The app walks you through setup. macOS will ask to **allow a VPN configuration**. Approve it. This is normal; Tailscale uses the VPN mechanism to create the private network.
4. **Sign in** with an identity you already have (for example Google, Apple, GitHub or Microsoft). **Each of you signs in with your own account** — don't share one.
5. When it says you're connected, Tailscale is running. It lives in your **menu bar** at the top right.

**Check it worked:** open **<https://login.tailscale.com/admin/machines>** in a browser while signed in. You should see your machine in the list with an address that starts with `100.`. That `100.x.x.x` address is your machine's Tailscale IP.

> **Write down the relay host's `100.x.x.x` address.** You'll need it several times below. In this guide it's shown as `100.101.102.103`; yours will differ.

## 4. Step 2: Let your friend reach your machine

Right now you and your friend each have your own separate private network. You need to let your friend's machine reach **just your machine** (the one that will run the relay). The cleanest way is to **share that one machine** with them. They do not join your network and you don't see their devices.

### 4a. [relay host] Share your machine with your friend

1. Open **<https://console.tailscale.com/admin/machines>** (same Machines page as before).
2. Find **your machine** in the list. Click the **⋯** (ellipsis) menu on its row and choose **Share**.
3. Pick a method:
   - **Share by email:** enter your friend's email and click **Share**. They get a single-use invite link.
   - **Copy invite link:** click **Copy share link** and send it to them yourself. **Treat the link like a password.** A single-use link works once and unused links expire after 30 days.
4. Wait for them to accept. Their email appears in the Share dialog once they have.

### 4b. [friend] Accept the share

1. Make sure you finished Step 1 and are signed in to **your own** Tailscale account.
2. Open the invite link (from the email, or sent to you directly) and accept. You must be the owner/admin of your own Tailscale network to accept, which you are by default since you just created it.
3. In the Tailscale admin console (**Machines** page) you should now see the relay host's machine listed.
4. **Note its `100.x.x.x` address as it appears for you.** It's usually the same address the relay host sees, but if it clashes with one of yours Tailscale gives it a different one. **Always use the address shown in your own console.**

### 4c. Check that it works (after Step 4 below, when the relay is running)

From your friend's machine, with the relay running on the relay host's machine:

```bash
nc -vz 100.101.102.103 8787
```

Expected: `Connection to 100.101.102.103 port 8787 [tcp/*] succeeded!` If it hangs and times out, see [Troubleshooting](#14-troubleshooting) ("Can't reach the relay"). That section also covers the one Tailscale setting that can block a shared machine and the simpler fallback of inviting your friend into your network instead.

> **Good to know:** a shared machine can *receive* connections but can't start them. That's perfect here: your friend's machine connects *to* the relay; the relay never connects out.

## 5. Step 3: Get Slopstream (both of you)

Two ways to get it — pick one.

### Option A: as a Claude Code plugin (no npm/Node setup to think about)

Inside a Claude Code session:

```
/plugin marketplace add mrlegendary25/slopstream
/plugin install slopstream@slopstream
```

This gives you `/slopstream:status`, `/slopstream:links`, `/slopstream:init` and `/slopstream:demo` as slash commands, with dependencies installed automatically on first use. Pairing (`setup`, `pair-create`, `pair-accept`, `invite`, `unlink`) still needs a real terminal on purpose (see Step 6) — run `/slopstream:get-started` for the exact commands to copy, including the on-disk path the plugin installed to.

### Option B: clone it and link the CLI yourself

```bash
git clone https://github.com/mrlegendary25/slopstream.git
cd slopstream

npm install
npm link
```

- `npm install` downloads the three libraries it needs.
- `npm link` gives you the `slopstream` command everywhere on your machine.
- **Don't move the folder after this** — the project settings written in Step 7 record its full path. If you do move it, re-run `slopstream init <chat>` in each linked project afterward.

**Check it worked:**

```bash
slopstream
```

You should see a list of commands (`setup`, `pair-create`, `pair-accept`, `invite`, `links`, `unlink`, `init`, `status`, `demo`).

If you get `command not found: slopstream`:
- If you use **nvm** and switched Node versions, run `npm link` again under the Node version you're using now.
- If `npm link` gives a permissions error, don't use `sudo`. Instead add this line to `~/.zshrc` (with the actual path you cloned into), then run `source ~/.zshrc`:
  ```bash
  alias slopstream='node /path/to/slopstream/bridge/cli.js'
  ```

*(Optional)* run the self-test to confirm everything on your machine works:

```bash
npm test
```

It runs three test files and should print three `N passed, 0 failed` summaries (one per file). A line saying `error: auth: bad user or token` in the middle is expected; the test checks that a wrong password is rejected.

## 6. Step 4: Start the relay (the relay host only)

Only the relay host does this step. Your friend skips to Step 5.

### 6a. Choose where the relay keeps its data

The relay stores users, links and an audit log in a folder. **Use one fixed folder** so you don't lose them by starting the relay from a different directory:

```bash
DATA_DIR="$HOME/.slopstream-relay"
```

You'll pass `DATA_DIR=...` on each command below. (It's shown inline so each command is copy-pasteable.)

### 6b. Create a user for each person

From inside the Slopstream folder you cloned in Step 3:

```bash
DATA_DIR="$HOME/.slopstream-relay" node relay/admin.js add-user <you>
DATA_DIR="$HOME/.slopstream-relay" node relay/admin.js add-user <friend>
```

(Pick any usernames you like — letters, digits, `.`, `_` and `-` only.) Each command prints:

```
user: <friend>
token: kJ8x...long-random-string...
(share this token with <friend> privately; it will not be shown again)
```

- **The token is a password. It is shown once.** The relay only stores a hash.
- Send your friend **their** token (and only theirs) through a private channel, such as a messaging app or a direct message, and tell them their username.
- If a token leaks or gets lost: `DATA_DIR="$HOME/.slopstream-relay" node relay/admin.js remove-user <name>`, then `add-user <name>` again.

### 6c. Start the relay

Find your Tailscale IP (the `100.x.x.x` address from Step 1), then, from inside the Slopstream folder:

```bash
HOST=100.101.102.103 PORT=8787 DATA_DIR="$HOME/.slopstream-relay" caffeinate -i node relay/server.js
```

Expected output:

```
slopstream relay listening on ws://100.101.102.103:8787  data=/Users/you/.slopstream-relay
```

What each part does:
- `HOST=100.101.102.103` makes the relay listen **only on your Tailscale address**, so nothing on your Wi-Fi or the internet can reach it.
- `PORT=8787` is the door number. Change it if something else uses it.
- `caffeinate -i` stops your machine from falling asleep from inactivity while the relay runs.

**Leave this terminal window open.** It is the relay. Closing it, or your machine going to sleep, takes the relay down and **nobody can message anybody**.

- **Laptop note:** closing the lid puts most laptops to sleep even with `caffeinate`. Keep the lid open and plugged in while you're working together, or later move the relay to a machine that's always on.
- **macOS firewall prompt:** if macOS asks *"Do you want the application 'node' to accept incoming network connections?"*, click **Allow**.

Now go back to [4c](#4c-check-that-it-works-after-step-4-below-when-the-relay-is-running) and have your friend run the `nc` test.

*(Optional)* a one-command launcher, so you don't retype this. Run this from inside the Slopstream folder, once:

```bash
cat > ~/start-slopstream-relay.sh <<EOF
#!/bin/bash
cd $(pwd)
HOST=100.101.102.103 PORT=8787 DATA_DIR="\$HOME/.slopstream-relay" exec caffeinate -i node relay/server.js
EOF
chmod +x ~/start-slopstream-relay.sh
```

(This bakes in the folder you ran it from and leaves `$HOME` to resolve normally — edit the IP to yours if you change it later.) Then `~/start-slopstream-relay.sh` starts the relay.

## 7. Step 5: Connect each machine to the relay (both)

Each of you, once per machine. You need the relay's address, your username and your token.

```bash
slopstream setup ws://100.101.102.103:8787 <you> <your-token>
```

Your friend runs the same command with their own details:

```bash
slopstream setup ws://100.101.102.103:8787 <friend> <friend-token>
```

Use the **relay host's** Tailscale address as seen from *your own* console (see 4b). Expected output:

```
OK. Authenticated as "<friend>". Saved to ~/.slopstream/config.json
```

That file (`~/.slopstream/config.json`) holds your relay address, username and token, readable only by you. Setup verifies your login before saving, so if it prints OK you're connected.

## 8. Step 6: Pair one chat with one chat

A **link** joins your chat to one or more of your friends' chats, into a shared group. You identify a chat by a short **label** you pick (letters, digits, `.`, `_`, `-`), for example `projX`. In practice the label stands for "the Claude Code chat I run in this project".

- Labels are yours. **Your `projX` and your friend's `projX` can be named differently**, e.g. `mine` and `theirs`.
- One label can have **one** link, but that link can hold more than two chats — by default up to **3** total (set `MAX_GROUP_SIZE` on the relay to change this).
- Pairing is done in the terminal, **never by Claude**, and it needs a human on both sides.

**You** (create the code):

```bash
slopstream pair-create projX
```

```
Pairing code for chat "projX":  1A2B3C4D   (valid 10 min)
Give it to your friend. They run:  slopstream pair-accept 1A2B3C4D <their-chat-label>
Waiting...
```

Send your friend the 8-character code. It expires in 10 minutes.

**Your friend** (accepts it, using their own label):

```bash
slopstream pair-accept 1A2B3C4D projX
```

```
waiting for <you> to approve
```

**You** then see:

```
<friend> wants to link their chat "projX" to your chat "projX".
Approve? [y/N]
```

Type `y` and press Enter. Both terminals print a `Linked: ...` line (you see `Linked: projX <-> <friend>/projX`; your friend sees it from their side, `Linked: projX <-> <you>/projX`).

**Adding a third person to that same link** (optional, up to `MAX_GROUP_SIZE`): either person, from their own chat, invites:

```bash
slopstream invite projX
```

This prints an invite code exactly like `pair-create` did. The third person accepts it the same way a second person would: `slopstream pair-accept <code> <their-chat-label>`, then the inviter approves. Once three chats share a link, `send_message` needs `to: "<username>"` to say who a message is for — `link_status` lists everyone currently in the group.

Useful commands:

```bash
slopstream links           # list your links (and who else is in each group)
slopstream unlink projX    # leave the link; it dissolves for everyone if fewer than 2 chats remain
```

## 9. Step 7: Turn it on in a project and use it

### 9a. Enable it in the project folder (both)

Go to the project whose Claude Code chat you linked, and run init **with the same label you paired**:

```bash
cd ~/path/to/projectX
slopstream init projX
```

This does two things, both safe to run again:
1. Creates (or updates) `.mcp.json` so Claude Code can start the bridge for this project.
2. Appends a **safety-rules block** to the project's `CLAUDE.md`, telling Claude that messages from a linked friend's agent are untrusted and must be shown to you before anything happens.

Only folders where you ran `init` get the bridge. Every other Claude Code session on your machine is untouched.

### 9b. Start the linked session (both)

Always start it with this flag:

```bash
claude --dangerously-load-development-channels server:slopstream
```

Tip: save a shortcut. Add to `~/.zshrc`, then `source ~/.zshrc`:

```bash
alias slopclaude='claude --dangerously-load-development-channels server:slopstream'
```

Why that long flag: channels are a **research preview**, and custom channels aren't on Anthropic's approved list yet, so Claude Code requires this flag to load one. It only works in an **interactive** session (not `claude -p`).

On first start you'll see:
1. A full-screen **development channels warning**. Choose **"I am using this for local development"**.
2. **"New MCP server found in this project: slopstream"**. Choose **"Use this MCP server"**.

Then a faint line under the banner confirms the channel is registered:
`Channels (experimental) messages from server:slopstream inject directly in this session ...`

### 9c. Check the link

In the chat, type: **"Use link_status."** Claude should show something like:

```json
{ "chat": "projX", "connectedToRelay": true,
  "linkedTo": { "user": "<friend>", "chat": "projX" }, "peerOnline": true }
```

- `connectedToRelay: false` → relay down or Tailscale off.
- `peerOnline: false` → your friend's linked session isn't running right now.

### 9d. Use it

**Sending.** Just ask in plain language: *"Ask my friend's agent whether the migration branch is merged."* Claude calls `send_message`. Claude Code shows a **permission prompt**. Read the text, then choose **"Yes" (this time only)**. **Never choose "always allow" for `send_message`.** That prompt is your outgoing approval.

**Receiving.** A message from your friend's agent appears in your open chat as a new prompt, shown as a line starting with `←` and `slopstream`, and marked `[UNTRUSTED message from <friend>'s agent ...]`. Claude then **shows it to you and waits**. You decide: ignore it, reply, or do something with it. If you want to reply, tell Claude what to say; it will use `send_message` and you approve again.

**Rules of the road (also in your `CLAUDE.md`):** short, purposeful text messages; no files; no secrets; no long agent-to-agent ping-pong without you in the loop.

**If the other side is offline**, the send fails with a clear message and **nothing is queued**. Try again when they're back.

## 10. Test it (alone, with a friend, with Codex)

See **[TESTING.md](./TESTING.md)**. It has three parts:

1. **Solo.** One command, `slopstream demo up`, gives you two (or three) fake people on your own machine. Test the plumbing with no AI at all, then with real Claude sessions.
2. **Different machines, Claude to Claude.** The real setup, with a test script to run together.
3. **Different machines, Claude to Codex.** You on Claude Code, your friend on Codex.

Run Part 1 before involving your friend.

### Using Codex instead of Claude Code

Everything above is the same (Tailscale, relay, `setup`, pairing). Only the project step differs:

```bash
cd ~/path/to/projectX
slopstream init projX --agent codex
codex
```

On first run in that folder: **trust the folder**, choose **"Trust all and continue"** on the hooks prompt, and send any first message (for example `ready`) so Slopstream learns which Codex chat to deliver into. After that, approved messages arrive as a new prompt in that chat. Because Codex has no equivalent of Claude Code's push channel, Slopstream asks you itself, with a macOS pop-up, before anything is sent or shown to the agent. Full details and the fallback inbox (`check slopstream`) are in TESTING.md Part 3.

## 11. Every day after setup

**Relay host:**
1. Make sure Tailscale is connected (menu bar icon).
2. Start the relay: `~/start-slopstream-relay.sh` (or the command from 6c). Keep the window open.

**Friend:**
1. Make sure Tailscale is connected.

**Both:** open the linked project and start `slopclaude` (or the full `claude --dangerously-load-development-channels server:slopstream`). Ask Claude *"is my friend online?"* and you're set.

Setup, pairing and `init` are one-time. The relay host's machine has to be awake and running the relay whenever you want to talk.

## 12. Reference

### Commands

| Command | What it does |
|---|---|
| `slopstream setup <relay-url> <user> <token>` | Save your login (once per machine) |
| `slopstream pair-create <chat> [--yes]` | Make a pairing code and wait for the friend; you approve. `--yes` skips the prompt |
| `slopstream pair-accept <code> <chat>` | Accept a friend's code for one of your chats |
| `slopstream invite <chat> [--yes]` | Add another person to a chat that's **already** linked, up to the relay's `MAX_GROUP_SIZE` |
| `slopstream links` | List your links (and who else is in each group) |
| `slopstream unlink <chat>` | Leave a link; it dissolves for everyone if fewer than 2 chats would remain |
| `slopstream init <chat> [--agent claude\|codex]` | In a project folder: wire it up for Claude Code (`.mcp.json`, `CLAUDE.md`) or Codex (`.codex/config.toml`, `AGENTS.md`) |
| `slopstream status` | Is this machine ready? Login, relay reachable, links and who is online, installed agents |
| `slopstream demo up [--a claude\|codex] [--b claude\|codex] [--c claude\|codex] [--port N]` | Solo test: private relay + two or three fake people + their project folders, on this machine |
| `slopstream demo status` / `demo down` | Show who is online in the demo / stop the demo relay |
| `slopstream demo peer --side a\|b\|c` | A no-AI stand-in for one side of the demo (type to send, `@username ...` to target one peer in a group, see what arrives) |
| `slopstream simulate --chat <chat> [--agent claude\|codex]` | The same stand-in against your real setup |
| `node relay/admin.js add-user <name>` | **[relay host]** create a user, print the token once |
| `node relay/admin.js list-users` / `remove-user <name>` | **[relay host]** manage users |
| `node relay/server.js` | **[relay host]** run the relay |
| `npm test` | Run the end-to-end checks |

Also installable as a Claude Code plugin (`/plugin install slopstream` — see Step 3): the safe, non-secret commands above are available as `/slopstream:status`, `/slopstream:links`, `/slopstream:init`, `/slopstream:demo` and `/slopstream:get-started`. `setup`/`pair-create`/`pair-accept`/`invite`/`unlink` are deliberately **not** slash commands, since they carry a private token or need a human y/N decision — `/slopstream:get-started` tells you the exact terminal commands to run instead.

### What Claude can do in a linked chat

Only **`send_message`** (with an optional `to`, required once more than one person is linked) and **`link_status`** (plus **`check_inbox`** on Codex). The agent cannot pair, invite, unlink, change who's allowed, or read your token.

### Settings (environment variables)

Relay (set on the command line when you start it):

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Address to listen on. Use your Tailscale IP |
| `PORT` | `8787` | Port |
| `DATA_DIR` | `./data` | Where users, links and the audit log live. **Set it to a fixed folder** |
| `MAX_TEXT` | `8000` | Max characters per message |
| `MAX_GROUP_SIZE` | `3` | How many chats one link can hold (2 = classic one-to-one; raise it to allow bigger groups) |
| `RATE_MAX` | `30` | Max messages per link per window |
| `RATE_WINDOW_MS` | `600000` | The window (10 minutes) |

Bridge and CLI:

| Variable | Default | Meaning |
|---|---|---|
| `SLOPSTREAM_HOME` | `~/.slopstream` | Where your login and local log live |
| `SLOPSTREAM_CHAT` | the project's folder name | Which chat label this session is. `init` sets it for you |
| `SLOPSTREAM_AGENT` | `claude` | `claude` (push via channel), `codex` (push via `codex queue`), or `generic` (inbox only). `init` sets it |
| `SLOPSTREAM_GATE` | `off` for claude, `native` otherwise | `native` = the bridge asks you with a macOS pop-up before sending or showing a message |
| `SLOPSTREAM_GATE_CMD` | none | Your own approver command (JSON on stdin, exit 0 = approve). For non-macOS or tests |
| `SLOPSTREAM_CODEX_BIN` | `codex` | Which `codex` program to call for the push |

### Where things are stored

| Path | What | Sensitive? |
|---|---|---|
| `~/.slopstream/config.json` | Relay address, your username, your token | Yes (readable only by you) |
| `~/.slopstream/log.jsonl` | Every message you sent or received, with text | Yes, it's your conversation |
| `<DATA_DIR>/users.json` | Users and **hashed** tokens | Moderate |
| `<DATA_DIR>/links.json` | Who is linked to whom | Low |
| `<DATA_DIR>/audit.jsonl` | Events plus **full message text** | **Yes**, see below |
| `<project>/.mcp.json` | How Claude Code starts the bridge (absolute path to this folder) | No |
| `<project>/.codex/config.toml`, `AGENTS.md` | The Codex equivalents of the two files around this row (between `slopstream:start`/`end` markers) | No |
| `<project>/CLAUDE.md` | Contains the safety-rules block between `slopstream:start` and `slopstream:end` markers | No |

**Whoever runs the relay can read every message** in `audit.jsonl`. That's fine between friends who trust each other. It's something to fix (end-to-end encryption) before this is used among strangers; see product.md.

## 13. Security: what is enforced and what is not

**Hard rules (enforced by the relay in code, covered by tests):**
- A chat only connects if it has a link. Third parties and unlinked chats can't attach.
- Delivery happens only if the target's linked session is connected right now. **Nothing is ever queued.**
- Pairing and invites need a one-time code **and** an existing member's approval.
- Wrong or missing token → rejected.
- Text only, 8000 characters max, 30 messages per 10 minutes per link.
- `unlink` takes effect immediately.
- Claude has no tool that can pair, invite, unlink or change the allowlist.

**Soft rules (depend on Claude and on you):**
- *Incoming messages are untrusted.* Every inbound message is wrapped and labelled, characters that could forge the wrapper are neutralised, and Claude is told to show you and wait. But a language model can still be tricked by a clever prompt-injection. **Treat what another agent says like a stranger's email.**
- *Outgoing approval (Claude Code)* is Claude Code's permission prompt. It protects you only if you **don't** pick "always allow".
- *Codex* has a **hard** gate: the bridge itself asks you with a pop-up before any message goes out or reaches the agent. If it can't ask, the answer is no.

**Your habits:**
- Don't add `send_message` to your always-allow list.
- Don't run the linked session in a mode that skips permission prompts.
- Don't approve sending file contents, keys or secrets.
- Keep your token private. If it leaks, the relay host removes and re-adds you.
- Unlink when a collaboration ends.

## 14. Troubleshooting

**`command not found: slopstream`**: see the end of [Step 3](#5-step-3-get-slopstream-both-of-you).

**`error: cannot reach relay ws://...`** / **Can't reach the relay** (on your friend's side):
1. Is the relay still running on the relay host's machine, with that machine awake? (Check its terminal; `lid closed = relay down`.)
2. Is **Tailscale connected** on both machines (menu bar icon)?
3. Is the address right? Use the relay host's IP **as shown in your own Tailscale admin console**, plus `:8787`.
4. From your friend's machine: `nc -vz 100.101.102.103 8787`. If it times out but the relay is running, Tailscale may be blocking the shared machine. A new Tailscale network starts with a permissive default policy, which normally works, but Tailscale's sharing docs say the owner's access rules must also cover the shared user. So open **Access controls** in the Tailscale console and make sure a rule lets shared users reach the relay host's machine on port 8787, for example (adapted from Tailscale's ACL docs; confirm the exact format in the console's policy editor, which validates it for you):
   ```json
   { "action": "accept", "src": ["autogroup:shared"], "dst": ["100.101.102.103:8787"] }
   ```
   **Simpler fallback:** instead of sharing the machine, invite your friend into your Tailscale network from the **Users** page of the admin console. Then the default rules just work. The downside is that your friend's devices then live in your network.
5. macOS firewall: when starting the relay, click **Allow** on the "accept incoming network connections" prompt.

**`error: auth: bad user or token`**: wrong username or token. Check for stray spaces. If the token is lost, the relay host runs `remove-user` then `add-user` and sends the new one.

**Bridge says `chat "projX" is not linked`** (visible in `link_status`): the label in `.mcp.json` doesn't match a link. Run `slopstream links`, then re-run `slopstream init <the-paired-label>` in the project.

**`link_status` shows `connectedToRelay: false`**: relay down, Tailscale off, or wrong address. If you moved or re-installed, run `slopstream setup ...` again.

**Messages don't appear in the session:**
- Did you start Claude Code **with** `--dangerously-load-development-channels server:slopstream`? Without it the bridge can send but incoming pushes are dropped silently.
- Are you using an API key? Channels need a claude.ai login (`/status`).
- Is Claude Code ≥ 2.1.80?
- Inside the session run `/mcp` and check `slopstream`. If it says `failed`, restart with debug logging: `claude --debug --dangerously-load-development-channels server:slopstream`, then read `~/.claude/debug/<session-id>.txt`.
- You see "blocked by org policy": only happens on Team/Enterprise plans where an admin must enable Channels. Not applicable to a personal Pro plan.

**`send_message` says `peer_offline` / "Not sent: the peer is offline"**: the other side's linked session isn't running or can't reach the relay. By design nothing is queued; try again when they're back.

**`rate_limited`**: more than 30 messages in 10 minutes on this link. Wait, or the relay host raises `RATE_MAX`.

**Another session of the same chat can't connect (`duplicate`)**: one chat label can be online in only one session at a time. The relay clears dead connections within about 30 seconds; the bridge retries automatically.

**Pair code "unknown or expired"**: codes last 10 minutes and work once. Run `pair-create` (or `invite`) again.

**Moved the project folder**: `.mcp.json` points to the old path. Re-run `slopstream init <chat>`.

**Your tokens/links vanished after restarting the relay**: you started it without a fixed `DATA_DIR`, from a different folder. Start it with `DATA_DIR="$HOME/.slopstream-relay"` as in Step 4.

## 15. Uninstall

```bash
slopstream unlink projX                  # for each link
# in each project: delete the "slopstream" entry from .mcp.json,
# and the block between <!-- slopstream:start --> and <!-- slopstream:end --> in CLAUDE.md
rm -rf ~/.slopstream                     # your saved login and local log
npm unlink -g slopstream                 # removes the command (run inside the project folder)
```

Relay host: stop the relay (Ctrl+C in its window) and optionally `rm -rf ~/.slopstream-relay`, and remove the Tailscale share from the Machines page.

## 16. Known limits

- **Not yet proven in a live Claude Code session or with the real macOS pop-ups.** Do TESTING.md Part 1 first. If a push doesn't render as expected, file an issue with what `/mcp` and the debug log show.
- **Inbound approval is soft** (see Part 13).
- **Both machines must be on, and the relay host's machine must be awake.** There's no always-on hosted relay yet.
- **Claude Code and Codex.** A chat is a labelled project, not a specific session id. Codex needs one first message per session to bind to the right chat, and a recent Codex (verified on 0.162.1). Other agents are on the roadmap in product.md.
- **Channels are a research preview** and may change in future Claude Code versions.
- The message format is shaped like the A2A standard (`contextId`, `parts[]`) but isn't full A2A yet.
- The relay host can read messages (no end-to-end encryption yet).

---

*Sources for the Tailscale steps: [Install Tailscale on macOS](https://tailscale.com/docs/install/mac), [Three ways to run Tailscale on macOS](https://tailscale.com/docs/concepts/macos-variants), [Node sharing](https://tailscale.com/kb/1084/sharing), [Access control policies](https://tailscale.com/kb/1018/acls). Channels details: [Claude Code channels reference](https://code.claude.com/docs/en/channels-reference).*
