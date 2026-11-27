# Windows

**Tested:** a Mac and a Windows machine linked together, Claude Code to Claude Code, end to end: linking, `link_status`, and messages both ways.

**Not tested yet:** Windows as a [self-hosted](./self-hosting.md) relay, and the PowerShell approval pop-up (only Codex uses it). **Codex on Windows doesn't work yet** (see below). If something here is wrong, please [open an issue](https://github.com/mrlegendary25/slopstream/issues).

## Install

In PowerShell:

```powershell
node -v                       # need 20 or newer: https://nodejs.org
claude --version              # need 2.1.80 or newer; if missing: irm https://claude.ai/install.ps1 | iex
npm install -g slopstream
```

Open a **new** PowerShell window after installing, so `claude` and `slopstream` are on your PATH. [Git for Windows](https://git-scm.com/downloads/win) is recommended: it gives Claude Code its Bash tool.

If `npm` fails with *"running scripts is disabled on this system"*, allow it once for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

If `slopstream` isn't recognised, npm's global folder (`$env:APPDATA\npm`) isn't on your PATH. Add it and open a new window.

Then follow the [Quick start](./quickstart.md) as written. `slopstream link`, `join` and the session command are the same on Windows.

## What's different

- **PowerShell 5.1 has no `&&`.** Run commands one per line. PowerShell 7 supports `&&`.
- **`~` is `$HOME`** in PowerShell.
- **Your token file isn't locked down.** `$HOME\.slopstream\config.json` is written owner-only on macOS and Linux, but Windows ignores that flag, so it gets your profile's default permissions. Fine on a single-user machine; tighten it yourself on a shared one.
- **Approval pop-ups** (the `native` gate, which Codex uses) are a PowerShell message box with **Yes** / **No** buttons, so the action is spelled out in the text. Set `SLOPSTREAM_PWSH=pwsh.exe` to use PowerShell 7. Not tested yet.
- **Codex push.** `codex` installs as a `.cmd` shim. Slopstream runs the script it wraps directly, not through `cmd.exe`, so message text never reaches a command interpreter. Set `SLOPSTREAM_CODEX_BIN` to the full path if `codex` isn't on your PATH.
- **Codex on Windows doesn't work yet.** `slopstream init <chat> --agent codex` writes the `SessionStart` hook into `.codex\config.toml` with POSIX quoting, which `cmd.exe` doesn't understand. Claude Code is unaffected.
- **Self-hosted relay on Windows:** there's no `caffeinate`, so stop the machine sleeping in **Settings → System → Power & battery**. Windows Defender Firewall may ask to let `node` accept connections. To stop the relay, press Ctrl+C in its window.

## Linux

The CLI, bridge and relay run on Linux, but there's no native approval pop-up yet. For Codex, set `SLOPSTREAM_GATE_CMD` to your own approver command (it gets the message as JSON on stdin; exit code 0 means approve). Claude Code doesn't need it: it uses its own permission prompt.
