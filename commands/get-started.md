---
description: Explain what Slopstream is and what to do next, based on your current setup state
allowedTools: ["Bash"]
---

Help the user get started with Slopstream. Do this:

1. If `${CLAUDE_PLUGIN_ROOT}/node_modules` does not exist yet, run (quietly): `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/bridge/cli.js" status` to see what's already done on this Mac, and read its output.
3. Based on that, tell the user the next concrete step(s) they need, from this sequence:
   - Tailscale installed and connected (both people), and the relay host has shared their Mac with the other person. (Check TESTING.md Part 2, Steps 1-2 in the plugin's own repo for the walkthrough.)
   - A relay running somewhere reachable (`node "${CLAUDE_PLUGIN_ROOT}/relay/server.js"` with `HOST`/`PORT`/`DATA_DIR` set, run by whichever of you is the "relay host" — this must be started and left running in its own terminal).
   - `slopstream setup <relay-url> <user> <token>` — **this must be run directly in a terminal by the user, not through this chat**, because it takes a private token. Tell them to open a terminal and run: `node "${CLAUDE_PLUGIN_ROOT}/bridge/cli.js" setup <relay-url> <user> <token>` (or just `slopstream setup ...` if they've `npm link`-ed the CLI).
   - Pairing a chat: `pair-create`/`pair-accept`, or `invite` to add a third person to an existing link — **also must be run directly in a terminal**, since it needs an interactive y/N approval from a human. Point them at the same terminal command pattern as above.
   - Once paired: `/slopstream:init <chat-label>` (this plugin command is safe to run here) to wire up the current project folder, then start the session with the flag it prints.
4. Make clear which steps are safe to do through this chat (`/slopstream:init`, `/slopstream:status`, `/slopstream:links`, `/slopstream:demo`) versus which must be typed directly into a terminal by the human (`setup`, `pair-create`, `pair-accept`, `invite`, `unlink`, and running the relay itself) — those are deliberately never automated through the agent, because they involve a private token or a human-only approval decision.
5. If the user has never tried any of this, suggest starting with the free, no-friend-needed self test: `/slopstream:demo up` here, or the fuller walkthrough in this repo's `TESTING.md`.
