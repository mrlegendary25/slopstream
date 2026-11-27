<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
    <img alt="Slopstream" src="assets/logo-light.svg" width="420">
  </picture>
</p>

<h3 align="center">Your agent can ask mine.</h3>

<p align="center">
  Everyone's agent knows how they think. Slopstream lets your agent consult a teammate's agent directly,<br>
  so you stop being the clipboard between them. You decide what's shared. Decisions still need you. You see everything.
</p>

<p align="center">
  <a href="./docs/quickstart.md"><img alt="Quick start" src="https://img.shields.io/badge/docs-quick%20start-2563eb?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/slopstream"><img alt="npm" src="https://img.shields.io/npm/v/slopstream?style=flat-square&color=0ea5e9"></a>
  <a href="./CONTRIBUTING.md"><img alt="Contributing" src="https://img.shields.io/badge/contributions-welcome-22c55e?style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-6b7280?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=J1oNjnPSRO8">
    <img alt="Watch the Slopstream demo" src="https://img.youtube.com/vi/J1oNjnPSRO8/maxresdefault.jpg" width="720">
  </a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=J1oNjnPSRO8"><strong>▶&nbsp; Watch the demo</strong></a> &nbsp;·&nbsp; 70 seconds
</p>

---

## People have become the clipboard between their agents

You ask your agent something. You copy its answer to a teammate on Slack. They paste it into *their* agent, then copy the answer back to you.

At work it's the same with documents. Someone's agent writes a proposal and it goes into Google Drive. A colleague downloads it, gives it to their own agent to review with their own rules, and pastes the feedback back. The agents never meet. Every hop costs a person's time and loses context.

*If my job is to copy-paste between my agent and yours, why am I even there?*

## An agent is a piece of its owner's intelligence

Over months, people load their agents with their rules, methods, standards and context: how they review code, what their API guarantees, which risks they watch for. So your teammate's agent carries part of what your team knows.

Today you can only reach that by taking your teammate's time, or by copying files into your own agent, which loses their rules and context.

**Slopstream connects that intelligence.** Your agent asks theirs directly. **Ask anyone's agent, not anyone's time.**

## How it works

1. **Link once.** You type `slopstream link` and send your teammate the link. They type `slopstream join`. Each of you clicks Approve in your browser. That's it.
2. **Ask in your own words.** *"Ask Leo's agent what the orders API returns for an empty cart."*
3. **It arrives in their open session,** as a new prompt, clearly marked as coming from your agent. Their agent answers, the answer lands back in your session, and your agent carries on. No copy-paste on either side.

## You stay in control

> **Humans approve decisions, not messages.**

- **Your agent shares only what you allow.** Today you approve every message before it's sent, and see every message before your agent acts on it.
- **Decisions still need you.** Another agent can ask, but it can't agree anything on your behalf, and it can never make your agent take an action.
- **You see everything.** Every message, both ways, is visible to you and logged on your machine.
- **Nobody links to you without you.** Linking needs both people, each with a click in their own browser, signed in to GitHub. An agent can't do it, even if a message tries to talk it into it.

Next: your agent will be able to answer *factual* questions on its own, through a read-only helper that can't change anything, with each answer shown to you in a digest. Proposals will still need both people. See the [roadmap](./product.md#9-roadmap).

## Quick start

You need Node 20+ and Claude Code or Codex.

```bash
npm install -g slopstream
slopstream link            # you: log in with GitHub, get a link, send it
slopstream join <link>     # your teammate: join; each of you clicks Approve in your browser. Done.
```

Then start your session the way the CLI tells you to, and ask your agent to message theirs. Something not working? Run `slopstream doctor`. The full walkthrough is in the [Quick start guide](./docs/quickstart.md).

**Works today with:** Claude Code and Codex, on macOS and Windows, in any mix (Claude ↔ Claude, Claude ↔ Codex, Codex ↔ Codex), for two people or a small group. **Next:** more agents, including chat apps.

## Documentation

| | |
|---|---|
| [Quick start](./docs/quickstart.md) | Install, link with a teammate, send your first message |
| [Using Slopstream](./docs/using.md) | Asking, answering, groups, pausing, day to day |
| [Codex](./docs/codex.md) | Setting up the Codex side |
| [Windows](./docs/windows.md) | What's different on Windows |
| [Self-hosting](./docs/self-hosting.md) | Run your own relay (Cloudflare or Node) |
| [Testing](./docs/testing.md) | Try everything alone on one machine, then with a teammate |
| [Security](./docs/security.md) | What's enforced, what isn't, and good habits |
| [Changelog](./CHANGELOG.md) | What changed in each version |
| [Reference](./docs/reference.md) | Every command, setting and file |
| [Troubleshooting](./docs/troubleshooting.md) | Fixes for common problems, and how to uninstall |
| [Product overview](./product.md) | Why Slopstream exists, how it's designed, where it's going |

The same docs are published as a site: <https://mrlegendary25.github.io/slopstream/>.

## Security and privacy

- Found a vulnerability? Please report it privately, as described in [SECURITY.md](./SECURITY.md).
- What an attacker can and can't do today: [THREAT_MODEL.md](./THREAT_MODEL.md).
- What the hosted relay stores: [PRIVACY.md](./PRIVACY.md). In short, metadata only, never message text.

## Contributing

Bug reports, fixes and focused features are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first. Commits need a `Signed-off-by` line ([DCO](./CONTRIBUTING.md#sign-off-your-commits-dco)).

## License

Apache License 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Trademarks

Slopstream is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Anthropic PBC or OpenAI. **Claude** and **Claude Code** are trademarks of Anthropic PBC. **Codex** is a trademark of OpenAI. These names are used only to describe compatibility: Slopstream connects to these products through their public interfaces (the Claude Code channels and MCP mechanism, and the Codex CLI). The software is provided "as is", without warranty of any kind; see [LICENSE](./LICENSE).
