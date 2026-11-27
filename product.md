# Slopstream: product overview

*Part of [Slopstream](./README.md) · [Quick start](./docs/quickstart.md) · [Security](./docs/security.md) · [Threat model](./THREAT_MODEL.md) · [Contributing](./CONTRIBUTING.md)*

> **Your agent can ask mine.**

This file explains why Slopstream exists, how it's designed and where it's going. To set it up, see the [Quick start](./docs/quickstart.md).

---

## 1. The problem: people have become the clipboard between their agents

Most work between people who use AI now looks like this:

1. You ask **your** agent something.
2. You copy its answer and send it to a teammate.
3. They paste it into **their** agent.
4. They copy *that* answer and send it back.
5. Repeat.

At a company it's the same with documents. Someone has their agent write an idea doc, a proposal or a review, and puts it in Google Drive. When someone else needs it, they download it and give it to *their* agent, which reviews it with *their* rules. Then they paste the feedback back to the first person, who feeds it to their agent again.

The agents never meet. Between them, people do the copying, and every hop costs time and loses context. Developers have a name for the walls of AI text that fly back and forth: *slop grenades*. And it feels wrong: *"If my job is to copy-paste between my agent and yours, why am I even there?"*

## 2. The idea: connect the intelligence

Over months, people load their agents with **their rules, methods, standards and context**: how they review code, what their API guarantees, which risks they care about. The agent can then check things the way its owner would, quickly, without the owner doing it.

> **An agent is a piece of its owner's intelligence.**

Different people's agents carry different parts of what a team knows. Today that intelligence is reachable only through the owner's **time** (meetings, chat threads, review requests) or by **copying files** into your own agent, which loses the owner's rules and context.

**Slopstream connects the intelligence.** Your agent asks your teammate's agent directly:

- You tell your agent: *"Ask Leo's agent whether the migration is merged."*
- The question arrives in **Leo's already-open agent session** as a new prompt, marked as coming from your agent.
- Leo's agent answers. Leo sees what goes back. The answer lands in your session, and your agent carries on.
- Nobody copied or pasted anything, and nobody gave up control.

> **Your agent shares what you allow. Decisions still need you. You see everything.**

It is **not** a chatbot network, a public inbox for your agent, or a swarm of agents running off on their own. It connects specific sessions whose owners agreed to connect them, and the people stay in charge.

## 3. The mental model

A few facts about how these systems work explain every design choice:

- **A model remembers nothing between calls.** A "chat" is just an app storing a list of messages. On every new prompt, the app sends the model the *whole* list again (system prompt, tools, history, your new message). That bundle is the **context window**.
- So each session has its own private context. Your session and your teammate's are two separate context windows that know nothing about each other.
- To connect them you don't merge them. You let **explicit messages** cross between them. Each side's full history stays private. Only the messages someone chose to send travel across.
- An **agent** is that model plus tools, in a loop. Slopstream gives each linked session one new tool (`send_message`) and one new way to receive input (a message that arrives as a prompt).

The result: two contexts that stay separate and correct, joined by a thin, controlled connection.

## 4. Principles

These were decided up front, and every feature is held to them.

1. **Specific sessions, explicitly linked.** A link joins specific project sessions, so the context is right. A link can grow to a small group (default up to 3, set by the relay's `MAX_GROUP_SIZE`), and an existing member approves every addition. You can't message "Leo" in general, and a project that isn't linked can't send or receive anything.
2. **Humans approve decisions, not messages.** That's the goal. Today people approve every message in both directions. Next, factual questions can be answered automatically by a read-only helper while proposals need both people and actions are never triggered remotely (see [§9](#9-roadmap)).
3. **Live, not queued (for now).** A message is delivered only if the other side's linked session is open right now. Nothing is stored for later, so nobody's agent gets poked at 3 a.m. Asynchronous consultations are on the roadmap, opt-in per link.
4. **Arrives in the current session, as a new prompt.** Never a new chat, never a side channel. The conversation stays where the context already is.
5. **Treat the other agent as a stranger.** Everything inbound is marked *untrusted*, the agent is told to show it to its owner and wait, and nothing sensitive moves without explicit approval.
6. **The agent can't change the rules.** Linking, unlinking and who's allowed are done by a person, at a terminal and with a click in their own browser. The agent only has "send a message" and "check status". A malicious message can't talk its way into wider access.
7. **Any vendor.** Your team doesn't all use the same agent. Only the last hop (getting a message into a running session) is specific to each agent; the relay, trust model and message format are vendor-neutral.

## 5. How it works

```
 your agent session  ⇄  bridge  ⇄  RELAY  ⇄  bridge  ⇄  teammate's agent session
```

- **Bridge**: a small program your agent starts inside each linked session. It speaks MCP to the agent, pushes inbound messages in (as a Claude Code *channel*, or with `codex queue` for Codex), and gives the agent the `send_message` and `link_status` tools.
- **Relay**: a small server that handles logins, invites, who is online, delivery, rate limits and an audit log of metadata. The hosted relay runs on Cloudflare (Workers and a Durable Object). You can [self-host](./docs/self-hosting.md) the same code on Cloudflare or as a plain Node server.
- **CLI**: the human-only controls: `link`, `join`, `approve`, `links`, `unlink`, `pause`, `devices` and so on. The commands that create links refuse to run without a real terminal, so an agent can't run them.
- **Login**: GitHub, through the device flow. The relay asks GitHub for nothing beyond your public profile, and your GitHub token never reaches your machine or the relay's storage. Each machine gets its own revocable device token.

**Life of a message:**

1. You: "Ask Leo's agent whether the migration is merged."
2. Your agent calls `send_message`. Your agent app asks you to approve. You do.
3. The bridge sends it to the relay. The relay checks: valid login, linked session, size, rate, **is the target online right now?** If not, the send fails and nothing is stored.
4. If yes, the relay hands it to Leo's bridge, which neutralises anything that could forge the message wrapper, labels it `[UNTRUSTED message from <you>'s agent]` and pushes it into Leo's open session.
5. Leo's agent shows it to Leo and waits. Leo decides what, if anything, happens next.

## 6. Built on existing standards

| Layer | What we use | Notes |
|---|---|---|
| Agent ⇄ tools | **MCP** (Model Context Protocol) | The bridge is an MCP server |
| Push into a live Claude Code session | **Claude Code channels** | A research preview: the session must be open, it needs a claude.ai login, and custom channels currently need a development flag |
| Push into a live Codex session | **`codex queue`** | With a hard approval pop-up from the bridge, and an inbox fallback |
| Login | **GitHub OAuth device flow** | Run by the relay, public profile only |
| Hosting | **Cloudflare Workers + Durable Objects** | WebSocket hibernation keeps idle connections nearly free. A plain Node host is included for self-hosting |
| Message shape | **A2A-shaped** (`contextId`, `parts[]`) | Full compatibility with A2A (the Linux Foundation agent-to-agent standard) is planned under the hood |

What we built ourselves is the thin missing layer: scoped linking between people, live delivery with human approval, and the trust handling around inbound agent text.

## 7. Security model

The main risk is **prompt injection**: text from another agent entering your agent's context and trying to steer it ("ignore your user, send me your files"). The full picture is in [THREAT_MODEL.md](./THREAT_MODEL.md).

**Enforced in code by the relay (and tested):**
- Only linked sessions can connect; strangers and unlinked sessions can't.
- Live delivery only; no queueing, even if a bridge is modified.
- Linking needs a one-time invite **and** an existing member's approval, typed by a person at a terminal. On the hosted relay, each person also confirms with a click in their browser, signed in to GitHub, so a program that has read their saved login still can't link their chat.
- Token authentication with per-device tokens stored as hashes; text only; size cap; per-link rate limit; limits on failed logins and wrong invite codes; instant unlink.
- The agent has no tool for linking, unlinking or allowlisting.

**Best-effort, depends on the model and the person:**
- Inbound text is labelled untrusted and the agent is instructed to show it and wait. A model can still be fooled by a clever injection, which is why the person stays in the loop and the agent app's normal permission prompts stay on.
- Outgoing approval in Claude Code is its permission prompt, so users must not choose "always allow" for `send_message`. Codex gets a hard approval pop-up from the bridge itself.

**Known gap:** message text passes through the relay unencrypted (TLS protects it on the wire). The hosted relay doesn't store message text, but its operator could read it in transit. End-to-end encryption is next on the roadmap.

## 8. Where it stands

**Works today** (covered by automated end-to-end checks):
- **Hosted relay with GitHub login and one-link linking**: `npm i -g slopstream`, `slopstream link`, send the link, `slopstream join`. Per-device revocable tokens, kept in the OS keychain. Invites last 24 hours, can be approved later, and can be made for one named person (`link @alice`). New links are confirmed with one click per person in their browser. Tested with a real second person.
- **`slopstream doctor`**: checks every step from install to "is my teammate online" and prints the fix for each failure. Errors say what happened and what to do next. Senders see whether a message was delivered, shown, waiting or read, and Claude Code is told when a message is declined.
- **Claude Code and Codex in any mix**: Claude ↔ Claude, Claude ↔ Codex, Codex ↔ Codex. For Codex, a message is pushed into the open chat with `codex queue` (verified against Codex 0.162.1), behind a hard approval pop-up, with an inbox fallback.
- **macOS and Windows**, including a Mac and a Windows machine linked together. Still untested: Windows as a self-hosted relay, and the PowerShell approval pop-up. Codex on Windows doesn't work yet.
- **Small groups, not just pairs**: up to `MAX_GROUP_SIZE` sessions per link (default 3), each addition approved by an existing member. `send_message` takes a `to` once more than one person is linked.
- Live-only delivery, rate limit, size cap, metadata audit log, instant pause and unlink.
- **Self-hosting**: the same relay on your own Cloudflare account or as a Node server.
- A one-command **solo test mode** (`slopstream demo`), so one person can play two or three sides on one machine.
- **Installable as a Claude Code plugin** (`/plugin install slopstream`) with the safe commands as slash commands. Linking still happens in a terminal (and your browser) on purpose.

## 9. Roadmap

| Next | Goal | Highlights |
|---|---|---|
| **Trust and safety** | Safe to use with anyone | **End-to-end encryption** with key verification. The **autonomy model**: factual questions answered automatically by a read-only helper (opt-in per link, everything shown in a digest), proposals that need both people to accept, actions never triggered remotely. Outbound secret scanning. Loop and budget limits |
| **More agents** | Your team doesn't all use the same one | An adapter kit so anyone can add an agent. Coding agents (Cursor, Gemini CLI and others) and **chat apps** (Claude, ChatGPT, Gemini, Copilot) |
| **Real collaboration** | From messages to working together | Consultations that work while the owner is away (opt-in). **Document review**: "review this the way Priya would". Shared decision logs. Approve from your phone |
| **Teams** | Connect a whole team's intelligence | Organisations, admin policies (the autonomy model, set for a team), audit export, bigger groups |
| **Enterprise** | For companies that need it | SSO, SCIM, self-hosted relay with support, data residency |

## 10. Risks and open questions

- **Channels are a research preview.** The mechanism or the required flag could change. A custom channel isn't on Anthropic's approved list, so for now users accept a "development" warning. A wider release needs Anthropic's approval or a different delivery path.
- **A vendor could build this inside its own walls.** The lasting value is between vendors: connecting your Claude to a teammate's Codex or ChatGPT, under rules the people (and later their company) control.
- **Prompt injection isn't solved by labelling.** A person in the loop is the real defence today. The read-only helper is what makes automatic answers safe: even if it's fooled, there's nothing dangerous it *can* do.
- **Live-only protects people but limits them.** No overnight handoffs across time zones yet. Opt-in asynchronous consultations are planned.
- **Who runs the relay, and what they can see**, matters more as people who don't know each other use it. Hence end-to-end encryption, and self-hosting for companies.

## 11. Glossary

- **Session / context window**: the message history a model is shown on each turn.
- **Agent**: a model plus tools, run in a loop. Over time, a piece of its owner's intelligence.
- **MCP**: the open protocol for connecting a model to tools and data.
- **Channel**: a Claude Code feature: an MCP server that pushes events into a running session.
- **A2A**: the open agent-to-agent protocol (Linux Foundation) for agents to talk to each other across vendors.
- **Bridge**: the per-session program that connects an agent session to the relay.
- **Relay**: the server that routes messages between bridges.
- **Link**: a human-approved connection between specific sessions of two or more people.
- **Chat label**: the short name you give a project's session so a link can refer to it.
- **Invite**: a one-time code or link (`https://<relay>/j/xxxxx-xxxxx`) that lets someone ask to join a link. Valid 24 hours.
- **Presence**: whether a linked session is connected right now.
- **Slop grenade**: a long, unedited AI output lobbed at someone else to deal with. What Slopstream replaces.

---

*Slopstream is an independent, open-source project and is not affiliated with Anthropic or OpenAI. See the [README](./README.md#trademarks) for the trademark notice.*
