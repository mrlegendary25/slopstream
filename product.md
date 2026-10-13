# Slopstream: product overview

> **Stop being the clipboard.**

Slopstream lets one person's AI agent talk directly to a friend's AI agent, from one specific chat to one specific chat, with both humans approving every message, and only while both are online.

For how to set it up, see [README.md](./README.md). This file explains what it is, why it exists, and where it's going.

---

## 1. The problem

Most knowledge work between people now looks like this:

1. You ask **your** AI something.
2. You copy its answer and send it to a coworker or friend.
3. They paste it into **their** AI.
4. They copy *that* answer and send it back.
5. Repeat.

Two powerful agents, and between them a human doing manual copy-paste. We've started calling the walls of text that fly back and forth *slop grenades*. They're long, unedited, and lobbed at the other person to deal with. The humans have become the **clipboard**.

It's slow, it loses context at every hop, it floods people with output nobody read, and it hides the real question inside pages of generated text.

## 2. What Slopstream is

A direct, **human-approved** channel between **two specific chats** run by two people.

- You tell your Claude: *"Ask Aarush whether the migration is merged."*
- The message goes to **Aarush's already-open chat** as a new prompt.
- His Claude shows it to him. He decides. If he wants, his agent answers back the same way.
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

1. **One chat to one chat.** A link joins a specific chat on your side to a specific chat on theirs, so the context is right. You can't message "your friend" in general, and a project that isn't linked can't send or receive anything.
2. **Humans approve, both directions.** Outgoing messages need your approval. Incoming messages are shown to you first. The agent doesn't act on a friend's agent's say-so.
3. **Both must be online.** A message is delivered only if the other side's linked chat is open right now. Nothing is queued, so nobody's agent gets poked at 3 a.m. to hand over a file.
4. **Arrives in the current chat, as a new prompt.** Never a new chat, never a side channel. The conversation stays where the context already is.
5. **Treat the other agent as a stranger.** Everything inbound is marked *untrusted*, the agent is told to be cautious, and nothing sensitive moves without explicit approval.
6. **The agent can't change the rules.** Pairing, unlinking and who's allowed are done by the human in the terminal. The agent only has "send a message" and "check status". A malicious message can't talk its way into widening access.
7. **Short, purposeful, text-only.** The cure for slop grenades is not more slop. Messages are plain text with a size cap and a rate limit, so they stay small: a question, an answer, a pointer.
8. **Don't reinvent the wheel.** Use existing protocols and tools. Build only the missing piece.

## 5. How it works

```
 your chat  ⇄  bridge  ⇄  RELAY  ⇄  bridge  ⇄  friend's chat
```

- **Bridge**: a small program Claude Code starts inside each linked chat. It speaks MCP to the chat. It pushes inbound messages in (as a Claude Code *channel*) and gives Claude the `send_message` and `link_status` tools.
- **Relay**: a tiny server that handles logins, one-time pairing, who is online, delivery, rate limits and an audit log. Today it runs on one of the friends' Macs; in future it can be hosted.
- **CLI**: the human-only controls: `setup`, `pair-create`, `pair-accept`, `links`, `unlink`, `init`.
- **Network**: for now a private Tailscale network, so the relay is never exposed to the open internet.

**Life of a message:**

1. You: "Ask Aarush whether the migration is merged."
2. Claude calls `send_message`. Claude Code asks you to approve. You do.
3. The bridge sends it to the relay. The relay checks: valid login, linked chat, size, rate, **is the peer online right now?** If not, it fails and nothing is stored for later.
4. If yes, the relay hands it to Aarush's bridge, which neutralises anything that could forge the message wrapper, labels it `[UNTRUSTED message from himnish's agent]` and pushes it into his open chat.
5. Aarush's Claude shows it to him and waits. He decides what, if anything, happens next.

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

**Works today** (covered by 24 automated end-to-end checks):
- Claude Code to Claude Code, on macOS
- One link per labelled chat, human-approved pairing, human-approved messages
- Online-only delivery, rate limit, size cap, audit log, instant unlink
- Relay run by one of the two friends over Tailscale

**Not yet:**
- Verified in a **live** Claude Code session (the first thing to test; README Part 10 is the rehearsal)
- Agents other than Claude Code
- A hosted relay, end-to-end encryption, full A2A, teams

## 9. Roadmap

| Version | Goal | Highlights |
|---|---|---|
| **V1** (now) | Two friends, Claude Code, one pair of chats | Everything above; prove the flow in a real session |
| **V2** | Something you can give to a stranger | Hosted relay, **end-to-end encryption**, proper presence, full **A2A** message framing, a packaged Claude Code plugin with an in-app `/link` flow |
| **V3** | Not just Claude | **Adapters for other agents** (Codex and others). Outbound is easy because they support MCP. Inbound is the hard part: Claude Code has push channels; other agents may not, so the plan is a native macOS notification ("X's agent sent a message. Approve?") plus an inbox the agent can read. Also per-link policies (allowed message types, no attachments, turn limits) |
| **V4** | Teams | Many-to-many links, discovery, shared policies, audit for organisations |

The design keeps **only the last hop** (getting a message into a running session) specific to each agent. Everything else (relay, trust model, message format) is agent-neutral, which is what makes "my Claude talks to his Codex" a new adapter rather than a rewrite.

## 10. Risks and open questions

- **Channels are a research preview.** The mechanism or the required flag could change. A custom channel isn't on Anthropic's approved list, so for now users accept a "development" warning. A public product would need Anthropic's approval or a different delivery path.
- **Anthropic could ship something like this natively.** The lasting value would be cross-vendor support and the trust/approval experience, not the pipe itself.
- **Prompt injection is not solved by labelling.** Human-in-the-loop is the real defence, and it limits how autonomous this can get.
- **Online-only is a feature and a limit.** It protects people, but it means no overnight handoffs. Whether to offer opt-in async later is an open question.
- **Who hosts the relay**, and what they can see, matters once strangers are involved (hence E2E encryption).
- **Rename pass:** the code still uses its working name `claude-link` for the command, MCP server name and settings folder.

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
