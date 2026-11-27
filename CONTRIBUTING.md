# Contributing to Slopstream

## Before you start

- Open a [GitHub issue](https://github.com/mrlegendary25/slopstream/issues) first for anything beyond a small fix (new features, protocol changes, anything touching `relay/` or `bridge/gate.js`), so the approach can be agreed on before you put in the work.
- Read [product.md](./product.md) for the design philosophy and [README.md § 13](./README.md#13-security-what-is-enforced-and-what-is-not) for what's a hard rule versus a soft one. A change that weakens a hard rule (delivery only while online, no queueing, human approval in both directions) needs a strong justification in the PR description.

## Development setup

```bash
git clone https://github.com/mrlegendary25/slopstream.git
cd slopstream
npm install
npm link      # makes the `slopstream` command available locally
```

Run the end-to-end test suite before opening a PR:

```bash
npm test
```

This runs `test/e2e.js`, `test/codex.js` and `test/group.js` against a real (local) relay and bridge; no network or AI access required. A line reading `error: auth: bad user or token` partway through is expected; that test intentionally checks a rejected login.

For a quick manual check without a real AI agent or a second machine, use the built-in demo:

```bash
slopstream demo up
slopstream demo status
slopstream demo peer --side a
```

See [TESTING.md](./TESTING.md) for the full walkthrough, including testing with a real Claude Code or Codex session and a second machine.

## Code style

- No comments unless they explain a non-obvious "why" (a hidden constraint, a workaround, a subtle invariant). The code should read clearly without them.
- Match the existing style in the file you're editing rather than introducing a new pattern.
- Prefer small, focused changes. This is not a framework; avoid adding abstractions, config flags, or options for hypothetical future use cases.
- stdout on the bridge (`bridge/server.js`) is the MCP transport; never `console.log` there. Use `console.error` (aliased as `err`) for diagnostics.

## Security-sensitive areas

Changes to any of the following get extra scrutiny, since they sit on the trust boundary between two people's agents:

- `relay/server.js`: authentication, linking/pairing, delivery, rate limiting.
- `bridge/gate.js`: the human-approval gate for inbound/outbound messages.
- `bridge/server.js`: sanitization of inbound text, the "untrusted input" framing shown to the agent, and the tools exposed to it.

If your change affects what is sent to, or trusted from, another person's agent, say so explicitly in the PR description and explain how the existing guarantees (see README § 13) are preserved.

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests where it makes sense (see `test/`).
3. Run `npm test` and make sure it passes.
4. Open a PR describing *why* the change is needed, not just what it does.
5. Keep PRs focused: one logical change per PR is easier to review than several bundled together.

## Reporting bugs

Open a [GitHub issue](https://github.com/mrlegendary25/slopstream/issues) with steps to reproduce, your OS/Node/Claude Code version, and (if relevant) the matching lines from `~/.slopstream/log.jsonl`; strip any private message text first.

**Security issues** (anything that could let an unlinked party connect, bypass the approval gate, or read another user's messages or token) should **not** be filed as a public issue. Report them privately as described in [SECURITY.md](./SECURITY.md) so a fix can go out before details are public.

## Code of conduct

Be respectful and constructive. This project is maintained by volunteers in their spare time.
