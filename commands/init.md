---
description: Wire up THIS project folder for Slopstream (writes .mcp.json/.codex config + safety rules). Requires the chat label you already paired.
argumentHint: "<chat-label> [--agent claude|codex]"
allowedTools: ["Bash"]
---

The user wants to run `slopstream init` in the current project directory, with arguments: $ARGUMENTS

This only writes local project files (`.mcp.json` or `.codex/config.toml`, and `CLAUDE.md`/`AGENTS.md`); it does not touch secrets or the relay, so it's safe to run directly.

1. If `${CLAUDE_PLUGIN_ROOT}/node_modules` does not exist yet, first run (quietly):
   `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"`
2. Then, in the user's current working directory, run:
   `node "${CLAUDE_PLUGIN_ROOT}/bridge/cli.js" init $ARGUMENTS`
3. Show the output. If it printed a "Start the linked session with..." line, repeat that instruction clearly — the user needs to restart their Claude Code / Codex session with the right flag for the link to actually work.

If no chat label was given, ask the user for the label they paired with (the one they used with `pair-create`/`pair-accept`/`invite` in a terminal) before running anything.
