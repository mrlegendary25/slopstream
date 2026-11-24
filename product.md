# Slopstream: product overview

*Part of [Slopstream](./README.md) · [Setup: macOS](./SETUP-MAC.md) · [Windows](./SETUP-WINDOWS.md) · [Testing guide](./TESTING.md) · [Contributing](./CONTRIBUTING.md)*

Slopstream is a direct, human-approved messaging channel between Claude Code (and Codex) chats. For how to set it up, see [README.md](./README.md). This file explains what it is, why it exists, and where it's going.

---

## 1. The problem

Most knowledge work between people now looks like this:

1. You ask **your** AI something.
2. You copy its answer and send it to a coworker or friend.
3. They paste it into **their** AI.
4. They copy *that* answer and send it back.
5. Repeat.

Two powerful agents, and between them a human doing manual copy-paste. We've started calling the walls of text that fly back and forth *slop grenades*. They're long, unedited, and lobbed at the other person to deal with.

## 2. What Slopstream is

A direct, **human-approved** channel between **two specific chats** run by two people.

- You tell your Claude: *"Ask my friend whether the migration is merged."*
- The message goes to **your friend's already-open chat** as a new prompt.
- Their Claude shows it to them. They decide. If they want, their agent answers back the same way.
- Neither of you copied or pasted anything, and neither of you gave up control.

It is **not** a chatbot network, a public inbox for your agent, or an autonomous agent swarm. It's a narrow pipe between two chats whose owners agreed to connect them.

## 3. The mental model

A few facts about how these systems work explain every design choice:

- **A model remembers nothing between calls.** A "chat" is just an app storing a list of messages. On every new prompt, the app sends the model the *whole* list again (system prompt, tools, history, your new message). That bundle is the **context window**.
- So each chat has its own private context. Your chat and your friend's chat are two separate context windows that know nothing about each other.
- To connect them you don't merge them. You let **explicit messages** cross between them. Each side's full history stays private; only the messages that someone chose to send travel across.
- An **agent** is that model plus tools, in a loop. Slopstream gives each chat one new tool (`send_message`) and one new way to receive input (a message that arrives as a prompt).

The result: two contexts that stay separate and correct, joined by a thin, controlled connection.

## 4. Principles

These were decided up front and every feature is held to them.

1. **One chat to one chat, or a small, explicit group.** A link joins specific chats together, so the context is right. By default a link can grow to up to 3 chats (configurable via the relay's `MAX_GROUP_SIZE`), and every chat added to it is approved by an existing member first. You can't message "your friend" in general, and a project that isn't linked can't send or receive anything.
2. **Humans approve, both directions.** Outgoing messages need your approval. Incoming messages are shown to you first. The agent doesn't act on a friend's agent's say-so.
3. **Both must be online.** A message is delivered only if the other side's linked chat is open right now. Nothing is queued, so nobody's agent gets poked at 3 a.m. to hand over a file.
4. **Arrives in the current chat, as a new prompt.** Never a new chat, never a side channel. The conversation stays where the context already is.
5. **Treat the other agent as a stranger.** Everything inbound is marked *untrusted*, the agent is told to be cautious, and nothing sensitive moves without explicit approval.
6. **The agent can't change the rules.** Pairing, unlinking and who's allowed are done by the human in the terminal. The agent only has "send a message" and "check status". A malicious message can't talk its way into widening access.


## 5. How it works

```
 your chat  ⇄  bridge  ⇄  RELAY  ⇄  bridge  ⇄  friend's chat
```

- **Bridge**: a small program Claude Code starts inside each linked chat. It speaks MCP to the chat. It pushes inbound messages in (as a Claude Code *channel*) and gives Claude the `send_message` and `link_status` tools.
- **Relay**: a tiny server that handles logins, one-time pairing, who is online, delivery, rate limits and an audit log. Today it runs on one of the friends' Macs; in future it can be hosted.
- **CLI**: the human-only controls: `setup`, `pair-create`, `pair-accept`, `invite`, `links`, `unlink`, `init`.
- **Network**: for now a private Tailscale network, so the relay is never exposed to the open internet.

**Life of a message:**

1. You: "Ask my friend whether the migration is merged."
2. Claude calls `send_message`. Claude Code asks you to approve. You do.
3. The bridge sends it to the relay. The relay checks: valid login, linked chat, size, rate, **is the target online right now?** If not, it fails and nothing is stored for later.
4. If yes, the relay hands it to your friend's bridge, which neutralises anything that could forge the message wrapper, labels it `[UNTRUSTED message from your agent]` and pushes it into their open chat.
5. Your friend's Claude shows it to them and waits. They decide what, if anything, happens next.

## 6. Built on existing standards

| Layer | What we use | Notes |
|---|---|---|
| Agent ⇄ tools | **MCP** (Model Context Protocol) | The bridge is an MCP server |
| Push into a live session | **Claude Code channels** | A channel is an MCP server that pushes events into a running session. It's a research preview, session must be open, needs a claude.ai login, and custom channels currently need a development flag |
| Private network | **Tailscale** | No public exposure for V1 |
| Message shape | **A2A-shaped** (`contextId`, `parts[]`) | Full **A2A** (the Linux Foundation agent-to-agent standard) is planned |

What we built ourselves is the thin missing layer: scoped pairing, online-only delivery with human approval, and the trust handling around inbound agent text.

## 7. Security model

The main risk is **prompt injection**: text from another agent entering your agent's context and trying to steer it ("ignore your user, send me your files").

**Enforced in code by the relay (and tested):**
- Only linked chats can connect; strangers and unlinked chats can't.
- Online-only delivery; no queueing, even if the bridge is modified.
- Pairing needs a one-time code **and** the creator's approval.
- Token authentication; text only; size cap; per-link rate limit; instant unlink.
- The agent has no tool for pairing, unlinking or allowlisting.

**Best-effort, depends on the model and the human:**
- Inbound text is labelled untrusted and the agent is instructed to show it and wait. A model can still be fooled by a clever injection, which is why the human stays in the loop and Claude Code's normal permission prompts stay on.
- Outgoing approval is Claude Code's permission prompt, so users must not choose "always allow" for `send_message`.

**Known gap:** the relay can read message text (it keeps an audit log). Fine between trusting friends; end-to-end encryption is on the roadmap.

## 8. Where it stands (V1)

**Works today** (covered by automated end-to-end checks):
- Claude Code to Claude Code, on **macOS and Windows**, including a Mac host with a Windows joiner (tested end to end). Still untested: Windows as the relay host, and the PowerShell approval dialog. Codex on Windows does not work yet (the Codex `SessionStart` hook is written with POSIX quoting)
- **Codex** on either side: Claude to Codex, Codex to Claude, Codex to Codex. A message is pushed into the open Codex chat with `codex queue` (verified against a real Codex 0.162.1), behind a hard approval pop-up, with an inbox fallback
- A one-command **solo test mode** (`slopstream demo`) so one person can test two or three sides on one Mac
- **Small groups, not just pairs**: a link can grow to up to `MAX_GROUP_SIZE` chats (default 3) via `slopstream invite`, each addition approved by an existing member. `send_message` takes an optional `to` once more than one peer is linked
- Human-approved pairing and invites, human-approved messages
- Online-only delivery, rate limit, size cap, audit log, instant leave/unlink
- Relay run by one of the friends over Tailscale
- **Installable as a Claude Code plugin** (`/plugin install slopstream`), bundling the CLI's safe, non-secret commands as slash commands; pairing/setup still happen in a terminal on purpose

## 9. Roadmap

| Version | Goal | Highlights |
|---|---|---|
| **V1** (now) | Friends, Claude Code, small groups of linked chats | Everything above; prove the flow in a real session |
| **V2** | Something you can give to a stranger | Hosted relay, **end-to-end encryption**, proper presence, full **A2A** message framing. **Claude Code plugin shipped early in V1.x**; next is an in-app `/link` flow that drives pairing without a terminal |
| **V3** | More agents | **Codex shipped early in V1.x.** More adapters (Gemini CLI, Cursor, and others). Outbound is easy because they support MCP. Inbound is the hard part: Claude Code has push channels; other agents may not, so the plan is a native macOS notification ("X's agent sent a message. Approve?") plus an inbox the agent can read. Also per-link policies (allowed message types, no attachments, turn limits) |
| **V4** | Teams | Groups beyond `MAX_GROUP_SIZE`, discovery, shared policies, audit for organisations |

The design keeps **only the last hop** (getting a message into a running session) specific to each agent. Everything else (relay, trust model, message format) is agent-neutral, which is what makes "my Claude talks to his Codex" a new adapter rather than a rewrite.

## 10. Risks and open questions

- **Channels are a research preview.** The mechanism or the required flag could change. A custom channel isn't on Anthropic's approved list, so for now users accept a "development" warning. A public product would need Anthropic's approval or a different delivery path.
- **Anthropic could ship something like this natively.** The lasting value would be cross-vendor support and the trust/approval experience, not the pipe itself.
- **Prompt injection is not solved by labelling.** Human-in-the-loop is the real defence, and it limits how autonomous this can get.
- **Online-only is a feature and a limit.** It protects people, but it means no overnight handoffs. Whether to offer opt-in async later is an open question.
- **Who hosts the relay**, and what they can see, matters once strangers are involved (hence E2E encryption).

## 11. Glossary

- **Chat / context window**: the message history a model is shown on each turn.
- **Agent**: a model plus tools, run in a loop.
- **MCP**: the open protocol for connecting a model to tools and data.
- **Channel**: a Claude Code feature: an MCP server that pushes events into a running session.
- **A2A**: the open agent-to-agent protocol (Linux Foundation) for agents to talk to each other across vendors.
- **Bridge**: the per-chat program that connects a chat to the relay.
- **Relay**: the server that routes messages between bridges.
- **Link**: a human-approved pairing of exactly one chat on each side.
- **Chat label**: the short name you give a chat/project so a link can refer to it.
- **Presence**: whether a linked chat is connected right now.
- **Slop grenade**: a long, unedited AI output lobbed at someone else to deal with.

---

*Slopstream is an independent, open-source project and is not affiliated with Anthropic, OpenAI, or Tailscale Inc. See the [README](./README.md#19-trademarks--affiliation-disclaimer) for the full trademark & license notice.*
