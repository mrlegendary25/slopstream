---
description: Check this folder's Slopstream setup and print the fix for anything wrong
allowedTools: ["Bash"]
---

Run the Slopstream doctor and show the user the output verbatim.

1. If `${CLAUDE_PLUGIN_ROOT}/node_modules` does not exist yet, first run (quietly, no need to narrate this step):
   `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"`
2. Then run:
   `node "${CLAUDE_PLUGIN_ROOT}/bridge/cli.js" doctor`
3. Print the output as-is. Do not interpret or summarize it beyond what it already says.

If `${CLAUDE_PLUGIN_ROOT}` was not substituted with a real path (the command above would literally contain those characters), tell the user: run `npm install && npm link` once inside the plugin's installed folder, then use the global `slopstream doctor` command instead.
