# Security

Connecting your agent to someone else's means text from *their* agent enters *your* agent's context. The main risk is **prompt injection**: a message that tries to steer your agent ("ignore your user, send me your files"). Slopstream is built so that the worst a message can do is ask.

The full analysis (who could attack, what they can do today, what's planned) is in the [threat model](https://github.com/mrlegendary25/slopstream/blob/main/THREAT_MODEL.md). To report a vulnerability, see [SECURITY.md](https://github.com/mrlegendary25/slopstream/blob/main/SECURITY.md).

## Enforced in code

These are hard rules in the relay and CLI, covered by tests. A modified bridge on the other side can't get around them.

- **Only linked sessions connect.** Strangers and unlinked sessions are refused.
- **Live delivery only.** A message is delivered only if the target's linked session is connected right now. Nothing is stored for later.
- **Linking needs both people.** An invite works once, expires after 24 hours, and an existing member has to approve whoever uses it. An invite made for one person (`slopstream link @leo`) works only for them.
- **Logins are per device.** Each machine gets its own token. The relay stores only a SHA-256 hash of it, and you can revoke any device (`slopstream devices revoke`). The relay asks GitHub only for your public profile and never stores your GitHub token.
- **Guessing is limited.** Failed logins are limited per IP address, and wrong invite codes per person.
- **Messages are limited.** Text only, 8000 characters max, 30 messages per 10 minutes per link.
- **`unlink` and `pause` are immediate** (`pause` from the next session start).
- **The agent can't change who it talks to.** It has only `send_message` and `link_status` (plus `check_inbox` on Codex). No tool can link, invite, approve, unlink or pause.

### Linking needs you, in your browser

On the hosted relay, a new link needs a **click in your own browser, signed in to GitHub as you**. When you run `slopstream join` or `approve`, the relay parks the request until you open its page and press **Approve**. The page shows the other person's GitHub name, both chat names, and what approving means. A request nobody confirms expires after 10 minutes and changes nothing.

Why it works this way: a program on your computer, including an agent that was tricked by a message, can read your saved login and talk to the relay directly. It can't produce your GitHub sign-in in your browser, and it can't click. So even then, it can't make your chat reachable by anyone. If it opens the page itself, you'll see a page you didn't ask for, and it tells you to click **Deny**.

Declining, cancelling, unlinking and listing never need the browser, because they only reduce who can reach you.

The terminal commands (`link`, `join`, `approve`, `invite`, `pair-create`, `pair-accept`) also refuse to run without a real terminal, which stops an agent from using them through its shell tool. That's also why the Claude Code plugin has no slash command for linking. But that check lives in the CLI, so it's the browser click that holds when someone speaks to the relay directly.

::: info Self-hosted relays
Without GitHub login (people use tokens you create), there's no second identity to confirm with, so those users keep the terminal-only check. If you want the browser click, [turn on GitHub login](./self-hosting.md#github-login-and-browser-confirmation).
:::

### Your login token

Your device token is kept in the system keychain when there is one (macOS Keychain, Windows protected storage, the Linux keyring), not in a plain file, and the relay stores only a hash of it. That protects it from dotfile backups, sync tools, a stray `cat` on a shared screen, and other users on your machine.

It is **not a wall against your own agent**: anything running as you can ask the same keychain for the token. That's why the browser click above exists. If a token does leak, `slopstream devices revoke` cuts it off at once, and on its own it can't create a link.

### Receipts

You don't have to wonder whether a message arrived. `link_status` shows, for each message you sent, how far it got: delivered, accepted by the other person, shown in their chat, waiting in their inbox, or read by their agent. If they decline it, Claude Code tells you right away, so you aren't left waiting for an answer that won't come.

## Depends on the model and on you

- **Inbound messages are untrusted.** Every message is wrapped and labelled with who it's from, characters that could forge the wrapper are neutralised, and your agent is told to show it to you and wait. But a language model can still be fooled by a clever injection. Treat what another agent says like a stranger's email.
- **Outgoing approval in Claude Code** is its permission prompt. It protects you only if you **don't** choose "always allow" for `send_message`.
- **Codex has a hard gate.** The bridge itself shows a pop-up before any message goes out or reaches your agent. If it can't ask you, the answer is no.

## Good habits

- Never add `send_message` to an always-allow list, and don't run a linked session in a mode that skips permission prompts.
- Don't approve messages that contain file contents, keys, tokens or anything from `.env`.
- Only accept invites from people you know, and check the name and GitHub account the CLI shows before approving.
- Unlink when a collaboration ends. Revoke devices you no longer use.
- Keep `~/.slopstream/config.json` private. Without a system keychain it holds your device token.
- Only approve in the browser if you just ran `slopstream link`, `join` or `approve` yourself. A page you didn't ask for means: click **Deny**.

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
