---
description: Run the solo Slopstream demo on this Mac (private relay + fake people + two/three project folders, no secrets involved)
argumentHint: "up [--a claude|codex] [--b claude|codex] [--c claude|codex] | status | down"
allowedTools: ["Bash"]
---

The user wants to run `slopstream demo` with arguments: $ARGUMENTS (default to "status" if nothing was given).

This only touches `~/.slopstream-demo` and a private local relay; it never touches the user's real login or a real friend, so it's safe to run directly.

1. If `${CLAUDE_PLUGIN_ROOT}/node_modules` does not exist yet, first run (quietly):
   `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"`
2. Then run:
   `node "${CLAUDE_PLUGIN_ROOT}/bridge/cli.js" demo $ARGUMENTS`
3. Show the output verbatim, including the exact follow-up commands it prints (e.g. `slopstream demo peer --side a`, or the `claude --dangerously-load-development-channels server:slopstream` launch lines); the user runs those themselves in separate terminals.
