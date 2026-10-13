# Slopstream

> ## Seamless slop grenades.
> *Safety pin included.* (The pin is your approve button.)

**Stop being the clipboard.** Slopstream links one Claude Code chat of yours to one Claude Code chat of a friend's, so the two agents can message each other directly, instead of the two of you copy-pasting their output back and forth.

- A message arrives as a **new prompt in the chat that is already open**. It never starts a new chat.
- **Both humans approve**: every outgoing message and every incoming one.
- **Only while both are online.** Nothing is queued, so nobody's agent can get pinged at 3 a.m.
- **One chat to one chat.** Not "anyone can message my Claude".

What it is and why it exists: see [product.md](./product.md). This file is the how-to.

> **Status.** V1. The relay, pairing, delivery rules and security checks are covered by automated end-to-end tests (`npm test`). It has **not yet been verified inside a live Claude Code session**. Part 10 (rehearsal on your own Mac) is how you check that before involving your friend.

---

## Contents

1. [How the pieces fit together](#1-how-the-pieces-fit-together)
2. [Before you start](#2-before-you-start)
3. [Step 1: Install Tailscale (both of you)](#3-step-1-install-tailscale-both-of-you)
4. [Step 2: Let your friend reach your Mac](#4-step-2-let-your-friend-reach-your-mac)
5. [Step 3: Get Slopstream (both of you)](#5-step-3-get-slopstream-both-of-you)
6. [Step 4: Start the relay (the relay host only)](#6-step-4-start-the-relay-the-relay-host-only)
7. [Step 5: Connect each Mac to the relay (both)](#7-step-5-connect-each-mac-to-the-relay-both)
8. [Step 6: Pair one chat with one chat](#8-step-6-pair-one-chat-with-one-chat)
9. [Step 7: Turn it on in a project and use it](#9-step-7-turn-it-on-in-a-project-and-use-it)
10. [Rehearse alone on your own Mac first (recommended)](#10-rehearse-alone-on-your-own-mac-first-recommended)
11. [Every day after setup](#11-every-day-after-setup)
12. [Reference](#12-reference)
13. [Security: what is enforced and what is not](#13-security-what-is-enforced-and-what-is-not)
14. [Troubleshooting](#14-troubleshooting)
15. [Uninstall](#15-uninstall)
16. [Known limits](#16-known-limits)

---

## 1. How the pieces fit together

```
 Himnish's Mac                                              Aarush's Mac
 ┌───────────────────────┐                                  ┌───────────────────────┐
 │ Claude Code session   │                                  │ Claude Code session   │
 │        ▲  │ stdio     │                                  │        ▲  │ stdio     │
 │        │  ▼           │                                  │        │  ▼           │
 │ BRIDGE (per session)  │───┐                          ┌───│ BRIDGE (per session)  │
 └───────────────────────┘   │      over Tailscale      │   └───────────────────────┘
                             ▼                          ▼
                       ┌─────────────────────────────────────┐
                       │ RELAY (runs on ONE of your Macs)    │
                       │ logins, pairing, "who is online",   │
                       │ delivery rules, rate limit, audit   │
                       └─────────────────────────────────────┘
```

| Piece | What it is | Who runs it |
|---|---|---|
| **Tailscale** | A private network between your Macs, so the relay never has to be on the open internet | both of you |
| **Relay** | A tiny server that routes messages between linked chats | **one person**, the "relay host" |
| **Bridge** | A small program that Claude Code starts inside each linked chat. It receives messages and gives Claude a `send_message` tool | both (Claude Code starts it for you) |
| **`slopstream` CLI** | Commands for setup, pairing and unlinking. **Claude itself cannot run these**, on purpose | both |

In this guide **Himnish is the relay host** and **Aarush is the friend**. Swap names as needed. Things only the relay host does are marked **[relay host]**. Everything else is for both.

## 2. Before you start

Each of you needs:

- [ ] A Mac on **macOS 12 (Monterey) or newer**
- [ ] **Node.js 20 or newer.** Check with `node -v`. If it's missing or old, install it from [nodejs.org](https://nodejs.org) or with `nvm install --lts`.
- [ ] **Claude Code v2.1.80 or newer.** Check with `claude --version`; update with `claude update`.
- [ ] Claude Code logged in with your **claude.ai account** (your Pro plan is fine). Channels do **not** work with an API key. Inside Claude Code, `/status` shows how you're logged in.
- [ ] A **Tailscale account** each (free, created in Step 1). Do not share one account.

## 3. Step 1: Install Tailscale (both of you)

**What Tailscale is, in one paragraph.** Tailscale makes a private, encrypted network between your devices, wherever they are. Each device gets a private address that looks like `100.101.102.103`. Only devices on your private network can reach it. That's how Aarush's Mac can talk to the relay on your Mac without you opening anything to the internet.

Do this on **each** Mac:

1. Go to **<https://tailscale.com/download>** and download the macOS app. Tailscale offers a Standalone version, a Mac App Store version and an open-source CLI version; **the Standalone version is the one they recommend**. Don't install both the App Store and Standalone versions on the same Mac.
2. Open the downloaded app and drag it to Applications if asked. Launch **Tailscale**.
3. The app walks you through setup. macOS will ask to **allow a VPN configuration**. Approve it. This is normal; Tailscale uses the VPN mechanism to create the private network.
4. **Sign in** with an identity you already have (for example Google, Apple, GitHub or Microsoft). **Each of you signs in with your own account.** Aarush must make his own, not use yours.
5. When it says you're connected, Tailscale is running. It lives in your **menu bar** at the top right.

**Check it worked:** open **<https://login.tailscale.com/admin/machines>** in a browser while signed in. You should see your Mac in the list with an address that starts with `100.`. That `100.x.x.x` address is your Mac's Tailscale IP.

> **Write down the relay host's `100.x.x.x` address.** You'll need it several times below. In this guide it's shown as `100.101.102.103`; yours will differ.

## 4. Step 2: Let your friend reach your Mac

Right now you and Aarush each have your own separate private network. You need to let Aarush's Mac reach **just your Mac** (the one that will run the relay). The cleanest way is to **share that one machine** with him. He does not join your network and you don't see his devices.

### 4a. [relay host] Share your Mac with Aarush

1. Open **<https://console.tailscale.com/admin/machines>** (same Machines page as before).
2. Find **your Mac** in the list. Click the **⋯** (ellipsis) menu on its row and choose **Share**.
3. Pick a method:
   - **Share by email:** enter Aarush's email and click **Share**. He gets a single-use invite link.
   - **Copy invite link:** click **Copy share link** and send it to him yourself. **Treat the link like a password.** A single-use link works once and unused links expire after 30 days.
4. Wait for him to accept. His email appears in the Share dialog once he has.

### 4b. [friend] Accept the share

1. Make sure you finished Step 1 and are signed in to **your own** Tailscale account.
2. Open the invite link (from the email or from Himnish) and accept. You must be the owner/admin of your own Tailscale network to accept, which you are by default since you just created it.
3. In the Tailscale admin console (**Machines** page) you should now see Himnish's Mac listed.
4. **Note its `100.x.x.x` address as it appears for you.** It's usually the same address Himnish sees, but if it clashes with one of yours Tailscale gives it a different one. **Always use the address shown in your own console.**

### 4c. Check that it works (after Step 4 below, when the relay is running)

From Aarush's Mac, with the relay running on Himnish's Mac:

```bash
nc -vz 100.101.102.103 8787
```

Expected: `Connection to 100.101.102.103 port 8787 [tcp/*] succeeded!` If it hangs and times out, see [Troubleshooting](#14-troubleshooting) ("Can't reach the relay"). That section also covers the one Tailscale setting that can block a shared machine and the simpler fallback of inviting Aarush into your network instead.

> **Good to know:** a shared machine can *receive* connections but can't start them. That's perfect here: Aarush's Mac connects *to* the relay; the relay never connects out.

## 5. Step 3: Get Slopstream (both of you)

Put the project somewhere permanent. **Don't move the folder later**, because the project settings written in Step 7 contain its full path.

```bash
cd /Users/mrlegendary/Code/learning/products/slopstream    # Himnish: your folder
# Aarush: put it wherever you like, e.g. ~/Code/slopstream, then cd into it

npm install
npm link
```

- `npm install` downloads the three libraries it needs.
- `npm link` gives you the `slopstream` command everywhere on your Mac.

**Check it worked:**

```bash
slopstream
```

You should see a list of commands (`setup`, `pair-create`, `pair-accept`, `links`, `unlink`, `init`).

If you get `command not found: slopstream`:
- If you use **nvm** and switched Node versions, run `npm link` again under the Node version you're using now.
- If `npm link` gives a permissions error, don't use `sudo`. Instead add this line to `~/.zshrc` (with your real path), then run `source ~/.zshrc`:
  ```bash
  alias slopstream='node /full/path/to/slopstream/bridge/cli.js'
  ```

*(Optional)* run the self-test to confirm everything on your Mac works:

```bash
npm test
```

It should end with `30 passed, 0 failed`. A line saying `error: auth: bad user or token` in the middle is expected; the test checks that a wrong password is rejected.

## 6. Step 4: Start the relay (the relay host only)

Only Himnish does this step. Aarush skips to Step 5.

### 6a. Choose where the relay keeps its data

The relay stores users, links and an audit log in a folder. **Use one fixed folder** so you don't lose them by starting the relay from a different directory:

```bash
DATA_DIR="$HOME/.slopstream-relay"
```

You'll pass `DATA_DIR=...` on each command below. (It's shown inline so each command is copy-pasteable.)

### 6b. Create a user for each person

```bash
cd /Users/mrlegendary/Code/learning/products/slopstream
DATA_DIR="$HOME/.slopstream-relay" node relay/admin.js add-user himnish
DATA_DIR="$HOME/.slopstream-relay" node relay/admin.js add-user aarush
```

Each command prints:

```
user: aarush
token: kJ8x...long-random-string...
(share this token with aarush privately; it will not be shown again)
```

- **The token is a password. It is shown once.** The relay only stores a hash.
- Send Aarush **his** token (and only his) through a private channel, such as Signal or a direct message, and tell him his username.
- If a token leaks or gets lost: `DATA_DIR="$HOME/.slopstream-relay" node relay/admin.js remove-user aarush`, then `add-user aarush` again.
- Usernames may only contain letters, digits, `.`, `_` and `-`.

### 6c. Start the relay

Find your Tailscale IP (the `100.x.x.x` address from Step 1), then:

```bash
cd /Users/mrlegendary/Code/learning/products/slopstream
HOST=100.101.102.103 PORT=8787 DATA_DIR="$HOME/.slopstream-relay" caffeinate -i node relay/server.js
```

Expected output:

```
slopstream relay listening on ws://100.101.102.103:8787  data=/Users/mrlegendary/.slopstream-relay
```

What each part does:
- `HOST=100.101.102.103` makes the relay listen **only on your Tailscale address**, so nothing on your Wi-Fi or the internet can reach it.
- `PORT=8787` is the door number. Change it if something else uses it.
- `caffeinate -i` stops your Mac from falling asleep from inactivity while the relay runs.

**Leave this Terminal window open.** It is the relay. Closing it, or your Mac going to sleep, takes the relay down and **nobody can message anybody**.

- **MacBook note:** closing the lid puts the Mac to sleep even with `caffeinate`. Keep the lid open and plugged in while you're working together, or later move the relay to a machine that's always on.
- **macOS firewall prompt:** if macOS asks *"Do you want the application 'node' to accept incoming network connections?"*, click **Allow**.

Now go back to [4c](#4c-check-that-it-works-after-step-4-below-when-the-relay-is-running) and have Aarush run the `nc` test.

*(Optional)* a one-command launcher, so you don't retype this. Run once:

```bash
cat > ~/start-slopstream-relay.sh <<'EOF'
#!/bin/bash
cd /Users/mrlegendary/Code/learning/products/slopstream
HOST=100.101.102.103 PORT=8787 DATA_DIR="$HOME/.slopstream-relay" exec caffeinate -i node relay/server.js
EOF
chmod +x ~/start-slopstream-relay.sh
```

Then `~/start-slopstream-relay.sh` starts the relay. (Edit the IP to yours.)

## 7. Step 5: Connect each Mac to the relay (both)

Each of you, once per Mac. You need the relay's address, your username and your token.

```bash
slopstream setup ws://100.101.102.103:8787 himnish <your-token>
```

For Aarush:

```bash
slopstream setup ws://100.101.102.103:8787 aarush <aarush-token>
```

Use the **relay host's** Tailscale address as seen from *your own* console (see 4b). Expected output:

```
OK. Authenticated as "aarush". Saved to /Users/aarush/.slopstream/config.json
```

That file (`~/.slopstream/config.json`) holds your relay address, username and token, readable only by you. Setup verifies your login before saving, so if it prints OK you're connected.

## 8. Step 6: Pair one chat with one chat

A **link** joins one of your chats to one of your friend's chats. You identify a chat by a short **label** you pick (letters, digits, `.`, `_`, `-`), for example `projX`. In practice the label stands for "the Claude Code chat I run in this project".

- Labels are yours. **Himnish's `projX` and Aarush's `projX` can be named differently**, e.g. `mine` and `theirs`.
- One label can have **one** link.
- Pairing is done in the terminal, **never by Claude**, and it needs **both** of you.

**Himnish** (creates the code):

```bash
slopstream pair-create projX
```

```
Pairing code for chat "projX":  1A2B3C4D   (valid 10 min)
Give it to your friend. They run:  slopstream pair-accept 1A2B3C4D <their-chat-label>
Waiting...
```

Send Aarush the 8-character code. It expires in 10 minutes.

**Aarush** (accepts it, using his own label):

```bash
slopstream pair-accept 1A2B3C4D projX
```

```
waiting for himnish to approve
```

**Himnish** then sees:

```
aarush wants to link their chat "projX" to your chat "projX".
Approve? [y/N]
```

Type `y` and press Enter. Both terminals print a `Linked: ...` line (Himnish sees `Linked: projX <-> aarush/projX`; Aarush sees it from his side, `Linked: projX <-> himnish/projX`).

Useful commands:

```bash
slopstream links           # list your links
slopstream unlink projX    # cut a link instantly, for both sides
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
2. Appends a **safety-rules block** to the project's `CLAUDE.md`, telling Claude that messages from the friend's agent are untrusted and must be shown to you before anything happens.

Only folders where you ran `init` get the bridge. Every other Claude Code session on your Mac is untouched.

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
  "linkedTo": { "user": "aarush", "chat": "projX" }, "peerOnline": true }
```

- `connectedToRelay: false` → relay down or Tailscale off.
- `peerOnline: false` → your friend's linked session isn't running right now.

### 9d. Use it

**Sending.** Just ask in plain language: *"Ask Aarush's agent whether the migration branch is merged."* Claude calls `send_message`. Claude Code shows a **permission prompt**. Read the text, then choose **"Yes" (this time only)**. **Never choose "always allow" for `send_message`.** That prompt is your outgoing approval.

**Receiving.** A message from Aarush's agent appears in your open chat as a new prompt, shown as a line starting with `←` and `slopstream`, and marked `[UNTRUSTED message from aarush's agent ...]`. Claude then **shows it to you and waits**. You decide: ignore it, reply, or do something with it. If you want to reply, tell Claude what to say; it will use `send_message` and you approve again.

**Rules of the road (also in your `CLAUDE.md`):** short, purposeful text messages; no files; no secrets; no long agent-to-agent ping-pong without you in the loop.

**If the peer is offline**, the send fails with a clear message and **nothing is queued**. Try again when they're back.

## 10. Rehearse alone on your own Mac first (recommended)

Before involving Aarush, run both sides yourself on one Mac. This is also the quickest way to confirm that messages show up properly inside **live** Claude Code, which the automated tests can't prove. You don't need Tailscale for this.

You'll use two fake users, two config folders, and two project folders.

**Terminal 1: the rehearsal relay** (local only, separate data folder):

```bash
cd /Users/mrlegendary/Code/learning/products/slopstream
DATA_DIR="$HOME/.slopstream-rehearsal" node relay/admin.js add-user rehearsal-a
DATA_DIR="$HOME/.slopstream-rehearsal" node relay/admin.js add-user rehearsal-b
# copy both tokens from the output
DATA_DIR="$HOME/.slopstream-rehearsal" node relay/server.js     # leave running
```

**Terminal 2: set up and pair.** Replace the tokens. Separate `SLOPSTREAM_HOME` folders keep this from touching your real setup:

```bash
SLOPSTREAM_HOME="$HOME/.slopstream-rehearsal-a" slopstream setup ws://127.0.0.1:8787 rehearsal-a <token-a>
SLOPSTREAM_HOME="$HOME/.slopstream-rehearsal-b" slopstream setup ws://127.0.0.1:8787 rehearsal-b <token-b>

SLOPSTREAM_HOME="$HOME/.slopstream-rehearsal-a" slopstream pair-create demo
# prints a code, then waits
```

**Terminal 3:**

```bash
SLOPSTREAM_HOME="$HOME/.slopstream-rehearsal-b" slopstream pair-accept <CODE> demo
```

Back in Terminal 2 press `y`.

**Create the two project folders:**

```bash
mkdir -p ~/slopstream-rehearsal/a ~/slopstream-rehearsal/b
cd ~/slopstream-rehearsal/a && slopstream init demo
cd ~/slopstream-rehearsal/b && slopstream init demo
```

**Tell each project which config folder to use.** Open `~/slopstream-rehearsal/a/.mcp.json` and add a line inside `env`:

```json
"env": {
  "SLOPSTREAM_CHAT": "demo",
  "SLOPSTREAM_HOME": "/Users/mrlegendary/.slopstream-rehearsal-a"
}
```

Do the same in `b/.mcp.json` with `.slopstream-rehearsal-b`. (Use your real home path.)

**Run both sides** in two new terminals:

```bash
cd ~/slopstream-rehearsal/a && claude --dangerously-load-development-channels server:slopstream
cd ~/slopstream-rehearsal/b && claude --dangerously-load-development-channels server:slopstream
```

In **a**, ask: *"Send the linked agent this message: hello from A."* Approve the prompt. In **b**, the message should appear and Claude should show it to you and wait.

If it works, you've verified the whole path. Clean up with:

```bash
SLOPSTREAM_HOME="$HOME/.slopstream-rehearsal-a" slopstream unlink demo
rm -rf ~/slopstream-rehearsal ~/.slopstream-rehearsal-a ~/.slopstream-rehearsal-b ~/.slopstream-rehearsal
```

## 11. Every day after setup

**Relay host:**
1. Make sure Tailscale is connected (menu bar icon).
2. Start the relay: `~/start-slopstream-relay.sh` (or the command from 6c). Keep the window open.

**Friend:**
1. Make sure Tailscale is connected.

**Both:** open the linked project and start `slopclaude` (or the full `claude --dangerously-load-development-channels server:slopstream`). Ask Claude *"is the peer online?"* and you're set.

Setup, pairing and `init` are one-time. The relay host's Mac has to be awake and running the relay whenever you want to talk.

## 12. Reference

### Commands

| Command | What it does |
|---|---|
| `slopstream setup <relay-url> <user> <token>` | Save your login (once per Mac) |
| `slopstream pair-create <chat> [--yes]` | Make a pairing code and wait for the friend; you approve. `--yes` skips the prompt |
| `slopstream pair-accept <code> <chat>` | Accept a friend's code for one of your chats |
| `slopstream links` | List your links |
| `slopstream unlink <chat>` | Cut a link immediately, on both sides |
| `slopstream init <chat>` | In a project folder: write `.mcp.json` and the safety rules |
| `node relay/admin.js add-user <name>` | **[relay host]** create a user, print the token once |
| `node relay/admin.js list-users` / `remove-user <name>` | **[relay host]** manage users |
| `node relay/server.js` | **[relay host]** run the relay |
| `npm test` | Run the 30 end-to-end checks |

### What Claude can do in a linked chat

Only two tools: **`send_message`** and **`link_status`**. Claude cannot pair, unlink, change who's allowed, or read your token.

### Settings (environment variables)

Relay (set on the command line when you start it):

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Address to listen on. Use your Tailscale IP |
| `PORT` | `8787` | Port |
| `DATA_DIR` | `./data` | Where users, links and the audit log live. **Set it to a fixed folder** |
| `MAX_TEXT` | `8000` | Max characters per message |
| `RATE_MAX` | `30` | Max messages per link per window |
| `RATE_WINDOW_MS` | `600000` | The window (10 minutes) |

Bridge and CLI:

| Variable | Default | Meaning |
|---|---|---|
| `SLOPSTREAM_HOME` | `~/.slopstream` | Where your login and local log live |
| `SLOPSTREAM_CHAT` | the project's folder name | Which chat label this session is. `init` sets it for you |

### Where things are stored

| Path | What | Sensitive? |
|---|---|---|
| `~/.slopstream/config.json` | Relay address, your username, your token | Yes (readable only by you) |
| `~/.slopstream/log.jsonl` | Every message you sent or received, with text | Yes, it's your conversation |
| `<DATA_DIR>/users.json` | Users and **hashed** tokens | Moderate |
| `<DATA_DIR>/links.json` | Who is linked to whom | Low |
| `<DATA_DIR>/audit.jsonl` | Events plus **full message text** | **Yes**, see below |
| `<project>/.mcp.json` | How Claude Code starts the bridge (absolute path to this folder) | No |
| `<project>/CLAUDE.md` | Contains the safety-rules block between `slopstream:start` and `slopstream:end` markers | No |

**Whoever runs the relay can read every message** in `audit.jsonl`. That's fine between friends who trust each other. It's something to fix (end-to-end encryption) before this is used among strangers; see product.md.

## 13. Security: what is enforced and what is not

**Hard rules (enforced by the relay in code, covered by tests):**
- A chat only connects if it has a link. Third parties and unlinked chats can't attach.
- Delivery happens only if the peer's linked session is connected right now. **Nothing is ever queued.**
- Pairing needs a one-time code **and** the creator's approval.
- Wrong or missing token → rejected.
- Text only, 8000 characters max, 30 messages per 10 minutes per link.
- `unlink` takes effect immediately for both sides.
- Claude has no tool that can pair, unlink or change the allowlist.

**Soft rules (depend on Claude and on you):**
- *Incoming messages are untrusted.* Every inbound message is wrapped and labelled, characters that could forge the wrapper are neutralised, and Claude is told to show you and wait. But a language model can still be tricked by a clever prompt-injection. **Treat what the other agent says like a stranger's email.**
- *Outgoing approval* is Claude Code's permission prompt. It protects you only if you **don't** pick "always allow".

**Your habits:**
- Don't add `send_message` to your always-allow list.
- Don't run the linked session in a mode that skips permission prompts.
- Don't approve sending file contents, keys or secrets.
- Keep your token private. If it leaks, the relay host removes and re-adds you.
- Unlink when a collaboration ends.

## 14. Troubleshooting

**`command not found: slopstream`**: see the end of [Step 3](#5-step-3-get-slopstream-both-of-you).

**`error: cannot reach relay ws://...`** / **Can't reach the relay** (Aarush):
1. Is the relay still running on Himnish's Mac, with the Mac awake? (Check Terminal 1; `lid closed = relay down`.)
2. Is **Tailscale connected** on both Macs (menu bar icon)?
3. Is the address right? Use the relay host's IP **as shown in your own Tailscale admin console**, plus `:8787`.
4. From Aarush's Mac: `nc -vz 100.101.102.103 8787`. If it times out but the relay is running, Tailscale may be blocking the shared machine. A new Tailscale network starts with a permissive default policy, which normally works, but Tailscale's sharing docs say the owner's access rules must also cover the shared user. So open **Access controls** in the Tailscale console and make sure a rule lets shared users reach your Mac on port 8787, for example (adapted from Tailscale's ACL docs; confirm the exact format in the console's policy editor, which validates it for you):
   ```json
   { "action": "accept", "src": ["autogroup:shared"], "dst": ["100.101.102.103:8787"] }
   ```
   **Simpler fallback:** instead of sharing the machine, invite Aarush into Himnish's Tailscale network from the **Users** page of the admin console. Then the default rules just work. The downside is that Aarush's devices then live in your network.
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

**Pair code "unknown or expired"**: codes last 10 minutes and work once. Run `pair-create` again.

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

- **Not yet proven in a live Claude Code session.** Do the rehearsal in Part 10 first. If a push doesn't render as expected, tell the maintainer what `/mcp` and the debug log show.
- **Inbound approval is soft** (see Part 13).
- **Both Macs must be on, and the relay host's Mac must be awake.** There's no always-on hosted relay yet.
- **Claude Code only (V1).** A chat is a labelled project, not a specific Claude session id. Codex and other agents are on the roadmap in product.md.
- **Channels are a research preview** and may change in future Claude Code versions.
- The message format is shaped like the A2A standard (`contextId`, `parts[]`) but isn't full A2A yet.
- The relay host can read messages (no end-to-end encryption yet).

---

*Sources for the Tailscale steps: [Install Tailscale on macOS](https://tailscale.com/docs/install/mac), [Three ways to run Tailscale on macOS](https://tailscale.com/docs/concepts/macos-variants), [Node sharing](https://tailscale.com/kb/1084/sharing), [Access control policies](https://tailscale.com/kb/1018/acls). Channels details: [Claude Code channels reference](https://code.claude.com/docs/en/channels-reference).*
