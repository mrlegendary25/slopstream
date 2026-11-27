# Setup on Windows (fast path)

> Using the hosted relay? You don't need this guide: see the Quick start in README.md. This guide is for self-hosting over Tailscale.

*Part of [Slopstream](./README.md) · [Setup on macOS](./SETUP-MAC.md) · [Product overview](./product.md) · [Testing guide](./TESTING.md) · [Contributing](./CONTRIBUTING.md)*

Minimum commands to get linked, in **PowerShell**. No explanations, no optional steps; if something breaks or you want to know *why*, see [README.md](./README.md) and [TESTING.md](./TESTING.md). Requires Windows 10 1809+ or 11, Node 20+, Claude Code ≥2.1.80.

> **Tested, with a known boundary.** A **Mac host with a Windows joiner, Claude Code to Claude Code**, has been run end to end: pairing, `link_status`, and messages in both directions. Two things in this file are still *untested*: **Windows as the relay host** (Part 2), and the **PowerShell approval pop-up**, which only the Codex path uses. **Codex on Windows does not work yet** (see [Part 5](#5-windows-notes-worth-knowing)). If something here is wrong, please [open an issue](https://github.com/mrlegendary25/slopstream/issues).

One person is the **host** (runs the relay). Everyone else is a **joiner**. Do Part 1 as everyone, then Part 2 (host) or Part 3 (joiner) as your role.

**Mixed Mac and Windows is fine.** The relay and the bridge speak the same protocol on both. If the host is on a Mac, they follow [SETUP-MAC.md](./SETUP-MAC.md) Part 2 and you follow Part 3 here.

**Prefer Git Bash?** If you install [Git for Windows](https://git-scm.com/downloads/win) (recommended below anyway), every command in [SETUP-MAC.md](./SETUP-MAC.md) runs unchanged in Git Bash, including `~` and `&&`. Use that file instead of this one and skip only `caffeinate -i`. This file is for people who want to stay in PowerShell.

---

## 1. Everyone

- **Git for Windows**: <https://git-scm.com/downloads/win>. Recommended, not strictly required: it gives Claude Code the Bash tool (without it, Claude Code falls back to its PowerShell tool), and it gives you `git clone`.
- **Node.js 20 or newer**: <https://nodejs.org>, then check it.
  ```powershell
  node -v
  ```
- **Claude Code**, logged in with a claude.ai account:
  ```powershell
  claude --version   # need >= 2.1.80; if missing: irm https://claude.ai/install.ps1 | iex
  ```
  Open a **new** PowerShell window after installing, so `claude` is on your PATH.
- **Tailscale**: download the Windows app from <https://tailscale.com/download>, open it, sign in with your own account (not shared). Note the `100.x.x.x` address it gives you.

> If `npm` fails with *"cannot be loaded because running scripts is disabled on this system"*, PowerShell's execution policy is blocking npm's script shim. Fix it once, for your user only:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

---

## 2. Host

> Running the relay **on Windows** is the part of this file that has not been tested. The tested setup is a Mac host with a Windows joiner. If your host is on a Mac, they use [SETUP-MAC.md](./SETUP-MAC.md) Part 2 and you skip to [Part 3](#3-joiner).

Get Slopstream, pick one:

```powershell
# Option A: Claude Code plugin (run inside a Claude Code session, then in PowerShell)
/plugin marketplace add mrlegendary25/slopstream
/plugin install slopstream@slopstream
# run /slopstream:get-started in that session (it prints the install path). Then, in PowerShell:
cd <path-it-printed>
npm install
npm link
```
```powershell
# Option B: clone it yourself (PowerShell only)
git clone https://github.com/mrlegendary25/slopstream.git
cd slopstream
npm install
npm link
```

Open a **new** PowerShell window and check the CLI is on your PATH:

```powershell
slopstream
```
That should print the usage list. If it says the term is not recognized, npm's global folder (`$env:APPDATA\npm`) is not on your PATH; add it, or use `node bridge\cli.js <command>` from the Slopstream folder everywhere below instead of `slopstream <command>`.

Share your Tailscale machine with each joiner: <https://console.tailscale.com/admin/machines> → **⋯** on your machine → **Share** → send them the invite link.

Now create the users and start the relay, **from inside the Slopstream folder**:

```powershell
$env:DATA_DIR = "$HOME\.slopstream-relay"
node relay/admin.js add-user <you>
node relay/admin.js add-user <joiner>     # repeat per joiner
$env:HOST = "<your-tailscale-ip>"
node relay/server.js
```
Each `add-user` prints a token. Copy them; the joiner needs theirs.

> `$env:VAR = "..."` sets the variable for **this window only**, and the relay you start in the same window inherits it. That is the PowerShell equivalent of macOS's `DATA_DIR=... node relay/server.js` prefix.
>
> **There is no `caffeinate` on Windows.** Stop the machine sleeping in **Settings → System → Power & battery → Screen and sleep** (set sleep to *Never* while you are linked), or the relay goes down and nobody can message anybody.
>
> When the relay first starts, **Windows Defender Firewall** may ask whether to allow `node` to accept incoming connections. Click **Allow** for private networks.

Leave that window running. Open a **new** PowerShell window for the rest, `cd` back into the Slopstream folder:

```powershell
slopstream setup ws://<your-tailscale-ip>:8787 <you> <your-token>
slopstream pair-create projX
```
Send the joiner the code it prints; type `y` when they accept.

```powershell
cd C:\path\to\your\project
slopstream init projX
claude --dangerously-load-development-channels server:slopstream
```

**Claude Code asks before it will use a project's MCP server.** On that first start, approve the prompt about this project's servers. Until you do, `slopstream` stays at `⏸ Pending approval` and `/mcp` does not list it. Check with `claude mcp list` from the project folder; if you dismissed the prompt earlier, run `claude mcp reset-project-choices` and start Claude again.

---

## 3. Joiner

Accept the Tailscale invite link the host sent you.

Get Slopstream, pick one:

```powershell
# Option A: Claude Code plugin (run inside a Claude Code session, then in PowerShell)
/plugin marketplace add mrlegendary25/slopstream
/plugin install slopstream@slopstream
# run /slopstream:get-started in that session (it prints the install path). Then, in PowerShell:
cd <path-it-printed>
npm install
npm link
```
```powershell
# Option B: clone it yourself (PowerShell only)
git clone https://github.com/mrlegendary25/slopstream.git
cd slopstream
npm install
npm link
```

Open a **new** PowerShell window (so `slopstream` is on your PATH), then:

```powershell
slopstream setup ws://<host-tailscale-ip>:8787 <you> <your-token>
slopstream pair-accept <code-from-host> projX
```

```powershell
cd C:\path\to\your\project
slopstream init projX
claude --dangerously-load-development-channels server:slopstream
```

**Claude Code asks before it will use a project's MCP server.** On that first start, approve the prompt about this project's servers. Until you do, `slopstream` stays at `⏸ Pending approval` and `/mcp` does not list it. Check with `claude mcp list` from the project folder; if you dismissed the prompt earlier, run `claude mcp reset-project-choices` and start Claude again.

A joiner never runs the relay, so nothing in this part is Windows-specific beyond `cd` taking a `C:\` path.

---

**Check it worked (either side):** inside Claude, type `Use link_status.` → expect `peerOnline: true`.

**Adding a 3rd person:** host runs `slopstream invite projX` instead of `pair-create`; the new person still runs `pair-accept` as above (up to `MAX_GROUP_SIZE`, default 3).

---

## 4. Stop / unlink / delete

Pick what you actually need: these stack, top to bottom.

**Stop being reachable on `projX` for now, keep the link** (anyone, host or joiner):
```powershell
slopstream pause projX     # undo with: slopstream resume projX
```
Restart Claude in that folder for it to take effect.

**Leave the link entirely** (anyone, host or joiner; dissolves it for everyone once fewer than 2 chats remain):
```powershell
slopstream unlink projX
```

**Remove Slopstream from this machine** (anyone, after unlinking everything):
```powershell
Remove-Item -Path "$HOME\.slopstream" -Recurse -Force
npm unlink -g slopstream
```

**Host only, also stop/delete the relay:**
```powershell
# Ctrl+C in the window running relay/server.js, then:
Remove-Item -Path "$HOME\.slopstream-relay" -Recurse -Force
```
Also remove the Tailscale share from <https://console.tailscale.com/admin/machines> if you no longer want that joiner reaching this machine.

---

## 5. Windows notes worth knowing

- **`&&` is not a statement separator in PowerShell 5.1** (the one that ships with Windows). That is why every command above is on its own line. PowerShell 7 supports `&&`.
- **`~` is `$HOME`** in PowerShell. `$HOME` is used throughout this file so you can paste lines as they are.
- **Stopping the relay.** `slopstream` finds a running relay through a pidfile the relay writes on start (`$env:DATA_DIR\relay.pid` and `$HOME\.slopstream-relay.pid`), not by scanning process names. If you started the relay some other way and `slopstream` cannot see it, just close its window. *Not yet tested on Windows,* since the tested setup hosts the relay on a Mac.
- **Approval pop-ups.** The `native` gate, which Codex uses and Claude Code does not, is a PowerShell message box with **Yes** / **No** buttons rather than named buttons, so the action is spelled out in the message text. Set `SLOPSTREAM_PWSH=pwsh.exe` to use PowerShell 7 for it. *Not yet tested,* because Claude Code to Claude Code never reaches it.
- **Your token file is not locked down.** `$HOME\.slopstream\config.json` is written owner-only on macOS. Windows ignores that mode flag, so the file gets your user profile's default permissions. Fine on a single-user machine; tighten it yourself on a shared one.
- **Codex on Windows does not work yet.** `slopstream init projX --agent codex` writes a `SessionStart` hook command into `.codex\config.toml` using POSIX single-quoting, which `cmd.exe` does not understand. Claude Code to Claude Code is unaffected. Tracked as a known gap.

---

*Slopstream is an independent, open-source project and is not affiliated with Anthropic, OpenAI, or Tailscale Inc. See the [README](./README.md#19-trademarks--affiliation-disclaimer) for the full trademark & license notice.*
