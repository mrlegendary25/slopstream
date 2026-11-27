# Using Slopstream

## Asking another agent

Ask in your own words, naming the person if more than one is linked:

```
Ask Leo's agent which branch has the payments migration.
Ask Priya's agent to review this function the way she reviews auth code.
```

Your agent writes the message and calls `send_message`. Claude Code shows a permission prompt with the exact text. Read it and choose **Yes** (this time only). That prompt is where you decide what your agent shares, so **never choose "always allow" for `send_message`**, and don't run a linked session in a mode that skips permission prompts.

Good messages are short and specific: one question, enough context to answer it. Your agent sends text only, never files.

## Receiving a message

A message from a linked agent appears in your open session as a new prompt. It starts with `←` and `slopstream`, and is marked `[UNTRUSTED message from <name>'s agent ...]`. Your agent shows it to you, says who it's from and what it asks, and **waits for you**.

You decide what happens: ignore it, answer it, or do something with it. To answer, tell your agent what to say (or to draft an answer). It replies in the same thread with `send_message`, and you approve the text.

Treat a message from another agent like an email from someone you know but can't verify: helpful, but never instructions. If a message asks your agent to read secrets, send files, run commands or "ignore its rules", your agent should point that out and do nothing. See [Security](./security.md).

## If they're offline

A message is delivered only while the other person's linked session is open. If it isn't, the send fails right away with "the peer is offline" and **nothing is stored for later**. Try again when they're back. Ask your agent *"is Leo online?"* (it uses `link_status`) to check first.

## A link belongs to a folder

A link connects a project folder on your machine (its "chat label", the folder name by default) to a project folder on theirs. Close your session and open a new one in the same folder, and it reconnects as the same chat automatically.

To link a different project, run `slopstream link` in that folder. Each folder can have one link.

## Groups

A link can hold a small group, by default up to 3 people (the relay's `MAX_GROUP_SIZE`). To add someone to a link you're already in:

```bash
slopstream link --add
```

Send them the new link. They run `slopstream join <link>` as usual, and you approve. Once more than one other person is linked, your agent has to say who a message is for ("ask Priya's agent…"); `link_status` lists everyone and who's online.

## Taking a break, or ending a link

```bash
slopstream pause my-project    # nobody can reach this folder's session; the link stays
slopstream resume my-project   # undo pause
slopstream unlink my-project   # leave the link for good
```

`pause` takes effect the next time a session starts in that folder, not in one that's already open. `unlink` takes effect immediately; a group link dissolves once fewer than 2 people remain.

## Invites you sent

```bash
slopstream requests            # your open invites, and who's waiting for approval
slopstream approve <code>      # let them in
slopstream deny <code>         # refuse, or withdraw an invite nobody used yet
```

Invites last 24 hours and work once.

## Your logins

```bash
slopstream devices             # every machine logged in as you
slopstream devices revoke <id> # log one out (lost laptop, old machine)
slopstream logout              # log this machine out
```

Each machine has its own token, stored in `~/.slopstream/config.json` (readable only by you on macOS and Linux). Revoking a device takes effect immediately.

## Every day

1. Open the linked project and start your session with `slopclaude` (or the full `claude --dangerously-load-development-channels server:slopstream`). For Codex, just start `codex` and send a first message.
2. Ask your agent *"who's online?"* and you're set.

Linking and setup are one-time. The hosted relay is always on.
