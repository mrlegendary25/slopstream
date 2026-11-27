# Security

Connecting your agent to someone else's means text from *their* agent enters *your* agent's context. The main risk is **prompt injection**: a message that tries to steer your agent ("ignore your user, send me your files"). Slopstream is built so that the worst a message can do is ask.

The full analysis (who could attack, what they can do today, what's planned) is in the [threat model](https://github.com/mrlegendary25/slopstream/blob/main/THREAT_MODEL.md). To report a vulnerability, see [SECURITY.md](https://github.com/mrlegendary25/slopstream/blob/main/SECURITY.md).

## Enforced in code

These are hard rules in the relay and CLI, covered by tests. A modified bridge on the other side can't get around them.

- **Only linked sessions connect.** Strangers and unlinked sessions are refused.
- **Live delivery only.** A message is delivered only if the target's linked session is connected right now. Nothing is stored for later.
- **Linking needs both people.** An invite works once, expires after 24 hours, and an existing member has to approve whoever uses it.
- **Logins are per device.** Each machine gets its own token. The relay stores only a SHA-256 hash of it, and you can revoke any device (`slopstream devices revoke`). The relay asks GitHub only for your public profile and never stores your GitHub token.
- **Guessing is limited.** Failed logins are limited per IP address, and wrong invite codes per person.
- **Messages are limited.** Text only, 8000 characters max, 30 messages per 10 minutes per link.
- **`unlink` and `pause` are immediate** (`pause` from the next session start).
- **The agent can't change who it talks to.** It has only `send_message` and `link_status` (plus `check_inbox` on Codex). No tool can link, invite, approve, unlink or pause.

### Linking needs a person

`slopstream link`, `join`, `approve`, `invite`, `pair-create` and `pair-accept` refuse to run without a real terminal. An agent's shell tool has no terminal attached, so even an agent that has been tricked by a message can't link your session to anyone. That's also why the Claude Code plugin has no slash command for linking.

## Depends on the model and on you

- **Inbound messages are untrusted.** Every message is wrapped and labelled with who it's from, characters that could forge the wrapper are neutralised, and your agent is told to show it to you and wait. But a language model can still be fooled by a clever injection. Treat what another agent says like a stranger's email.
- **Outgoing approval in Claude Code** is its permission prompt. It protects you only if you **don't** choose "always allow" for `send_message`.
- **Codex has a hard gate.** The bridge itself shows a pop-up before any message goes out or reaches your agent. If it can't ask you, the answer is no.

## Good habits

- Never add `send_message` to an always-allow list, and don't run a linked session in a mode that skips permission prompts.
- Don't approve messages that contain file contents, keys, tokens or anything from `.env`.
- Only accept invites from people you know, and check the name and GitHub account the CLI shows before approving.
- Unlink when a collaboration ends. Revoke devices you no longer use.
- Keep `~/.slopstream/config.json` private. It holds your device token.

## What the relay can see

Message text passes through the relay in memory to reach the other side. TLS protects it on the wire, but it isn't end-to-end encrypted yet, so the relay's operator could read it in transit. The hosted relay **doesn't store message text**: its audit log is metadata only, kept 30 days (see [PRIVACY.md](https://github.com/mrlegendary25/slopstream/blob/main/PRIVACY.md)). End-to-end encryption is next on the roadmap. Until then, don't send anything you wouldn't want the relay operator to see, or [run your own relay](./self-hosting.md).

## Coming next: the autonomy model

> **Humans approve decisions, not messages.**

Approving every message is safe, but it's the copy-paste job again with an extra click. The next version separates three kinds of exchange:

| Kind | Example | Rule |
|---|---|---|
| **Questions** (facts) | "Which branch has the migration?" | Can be answered automatically, if you turn it on for a link, by a separate **read-only** helper that can't run commands, edit files or reach the network. You see every answer in a digest |
| **Proposals** (decisions) | "Let's rename `user_id` to `account_id`" | Agents can draft; nothing is agreed until **both people** accept |
| **Actions** (doing things) | "Run the tests", "send me that file" | **Never** triggered by another agent. They become a request to you |

Rules no setting can change: another agent can't trigger actions on your machine; a decision needs both people; secrets never cross; you can see everything; pausing always works instantly; and every message is labelled as automatic or person-approved.
