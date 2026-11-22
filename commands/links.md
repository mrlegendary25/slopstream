---
description: List your Slopstream links and who in each group is online right now
allowedTools: ["Bash"]
---

1. If `${CLAUDE_PLUGIN_ROOT}/node_modules` does not exist yet, first run (quietly):
   `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"`
2. Then run:
   `node "${CLAUDE_PLUGIN_ROOT}/bridge/cli.js" links`
3. Show the output verbatim. If it says "(no links)" or "Not set up", tell the user they need to run `slopstream setup ...` and pair a chat first; those steps involve a private token and a human approval, so they must be done directly in a terminal, not through this chat (see the get-started command).
