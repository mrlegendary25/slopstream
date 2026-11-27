---
description: Explain what Slopstream is and what to do next, based on your current setup state
allowedTools: ["Bash"]
---

Help the user get started with Slopstream. Slopstream lets their agent consult a teammate's agent directly, instead of them copy-pasting between the two; each person approves what's shared. Do this:

1. If `${CLAUDE_PLUGIN_ROOT}/node_modules` does not exist yet, run (quietly): `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/bridge/cli.js" status` to see what's already done on this Mac, and read its output.
3. Based on that, tell the user the next concrete step(s) they need. The default is the hosted relay, no servers needed:
   - Install the CLI once: `npm install -g slopstream` (needs Node 20+).
   - Log in with GitHub: `slopstream login` (`slopstream link` and `slopstream join` do this automatically the first time).
   - One person types `slopstream link` in their project folder in a terminal. It prints a link like `https://<relay>/j/abcde-fghjk`. They send it to their teammate.
   - The teammate opens the link, then types `slopstream join <code>` in their own project folder. The first person approves when asked (or later with `slopstream requests` / `slopstream approve <code>`).
   - **All of these must be typed by the human in a terminal, never run through this chat.** `link`, `join` and `approve` refuse to run without a terminal on purpose, so an agent (or a message that tricks it) cannot link chats.
   - Both `link` and `join` already wire up the project folder. `/slopstream:init <chat-label>` (safe to run here) redoes that wiring. Then start the session with the flag it prints.
   - Advanced: running your own relay (on Cloudflare, or as a Node server) is covered in this repo's `docs/self-hosting.md`.
4. Make clear which steps are safe to do through this chat (`/slopstream:init`, `/slopstream:status`, `/slopstream:links`, `/slopstream:demo`) versus which must be typed directly into a terminal by the human (`login`, `link`, `join`, `approve`, `setup`, `pair-create`, `pair-accept`, `invite`, `unlink`, and running a relay yourself); those are deliberately never automated through the agent, because they involve a private token or a human-only approval decision.
5. If the user has never tried any of this, suggest starting with the free, no-teammate-needed self test: `/slopstream:demo up` here, or the fuller walkthrough in this repo's `docs/testing.md`.
