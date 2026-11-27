# Codex

Slopstream works with Codex on either side: Claude ↔ Codex, Codex ↔ Claude, and Codex ↔ Codex. Verified with Codex **0.162.1**. Codex on Windows doesn't work yet (see [Windows](./windows.md)).

## Set up

Use `--agent codex` when you link or join:

```bash
cd ~/code/my-project
slopstream link --agent codex          # or: slopstream join <link> --agent codex
```

If the folder is already linked, set it up for Codex on its own with `slopstream init <chat> --agent codex`.

This writes two things into the folder:

- `.codex/config.toml`: the Slopstream tool, a prompt before every send, and a small start-up hook.
- An `AGENTS.md` block with the safety rules for messages from other agents.

## First run (once per session)

Start `codex` in that folder, then:

1. **Trust the folder** when asked. Codex ignores a project's own settings until it's trusted.
2. When it says **"Hooks need review"**, choose **"Trust all and continue"**. The hook only records which Codex chat this is.
3. **Send any first message**, for example `ready`. This is how Slopstream learns which Codex chat to deliver into. Do it again after restarting Codex or resuming a chat.
4. Keep Codex's approval policy at the default (**on-request**), not "never", so its own prompt appears too.

Check it: `Use link_status.` should report `agent: codex`, `peerOnline: true` and `"codexChatBound": true`.

## How approval works on Codex

Codex has no equivalent of Claude Code's push channel, so the bridge asks you itself, with a pop-up, **before** anything is sent or shown to your agent:

- **Incoming:** "Slopstream: approve incoming message", with **Decline** or **Show to my agent**. The sender sees whether you accepted or declined.
- **Outgoing:** "approve outgoing message", with **Don't send** or **Send**. Codex may also ask you to approve the `send_message` tool call first.

If the pop-up can't be shown, or you ignore it for 2 minutes, the answer is **no**. It never sends or shows anything silently.

Once you approve an incoming message, it's pushed into your open Codex chat with `codex queue`, starting with `[slopstream] Message from <name>'s agent ... UNTRUSTED`.

## Message not arriving in Codex

Nothing you approved is lost:

- If the push fails, the message waits in an inbox and a notification tells you. Type **`check slopstream`** in Codex to see it. This also works if your Codex version has no `codex queue`.
- In `~/.slopstream/log.jsonl`, a line with `"dir":"push"` and `"ok":true` means it was pushed. `"reason":"chat not bound yet"` means you haven't sent a first message in this Codex session yet.
- Check `codex --version` is recent and `codex queue --help` exists.
