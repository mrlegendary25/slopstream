# Contributing to Slopstream

Thanks for helping. Slopstream lets people's agents consult each other directly, with each person in control. Contributions that make that safer, simpler or available to more agents are very welcome.

## Before you start

- Open a [GitHub issue](https://github.com/mrlegendary25/slopstream/issues) first for anything beyond a small fix (new features, protocol changes, anything touching `relay/` or `bridge/gate.js`), so the approach is agreed before you put in the work.
- Read [product.md](./product.md) for the design principles and [THREAT_MODEL.md](./THREAT_MODEL.md) for what's a hard rule. A change that weakens one of the security invariants listed at the end of the threat model (live delivery only, no queueing, approval of links by a person, no agent tool that changes links) needs a strong justification in the PR.

## Development setup

You need Node 20 or newer.

```bash
git clone https://github.com/mrlegendary25/slopstream.git
cd slopstream
npm ci
npm link      # makes the `slopstream` command use your checkout
```

Run the tests before opening a PR:

```bash
npm test
```

This runs five suites against a local relay and bridge, with no network or AI needed: `test/core.js` (relay core unit tests), `test/e2e.js`, `test/group.js`, `test/codex.js` (end to end against the Node relay) and `test/login.js` (GitHub login and `link` / `join` against a fake GitHub). A line reading `error: auth: bad user or token` partway through is expected; a test checks that a wrong token is rejected.

For a quick manual check without an AI agent or a second machine:

```bash
slopstream demo up
slopstream demo peer --side a     # in a second terminal
slopstream demo peer --side b     # in a third
```

See [docs/testing.md](./docs/testing.md) for the full walkthrough, including real Claude Code and Codex sessions.

To work on the Cloudflare host, see [relay/cloudflare/README.md](./relay/cloudflare/README.md) (needs Node 22.12+ for `wrangler`). To preview the docs site: `cd docs && npm ci && npm run dev`.

## Code style

- No comments unless they explain a non-obvious "why" (a hidden constraint, a workaround, a subtle invariant).
- Match the existing style in the file you're editing.
- Prefer small, focused changes. Avoid new abstractions, flags or options for hypothetical future needs.
- stdout in the bridge (`bridge/server.js`) is the MCP transport: never `console.log` there. Use `console.error`.
- **Dependencies:** the runtime has three (`@modelcontextprotocol/sdk`, `ws`, `zod`). Adding one needs a good reason in the PR. Versions are pinned exactly (`.npmrc` has `save-exact=true`); commit the lockfile.

## Security-sensitive areas

Changes here get extra review (see `.github/CODEOWNERS`), because they sit on the trust boundary between two people's agents:

- `relay/core.js`: authentication, devices, invites and linking, delivery, rate limits, the audit log.
- `relay/server.js`, `relay/cloudflare/`: the hosts that feed the core.
- `bridge/server.js`: sanitising inbound text, the untrusted-message wrapper, the tools exposed to the agent.
- `bridge/gate.js`: the human approval gate.
- `bridge/cli.js`: the terminal-only checks on linking commands.

If your change affects what is sent to, or trusted from, another person's agent, say so in the PR description and explain how the invariants in [THREAT_MODEL.md](./THREAT_MODEL.md) still hold. Update the threat model if a trust boundary changes.

## Sign off your commits (DCO)

Every commit must be signed off under the [Developer Certificate of Origin](https://developercertificate.org/) (DCO 1.1). By signing off you certify that you wrote the change, or otherwise have the right to submit it under this project's license (Apache-2.0). The full text:

> Developer Certificate of Origin, Version 1.1
>
> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open source license and I have the right under that license to submit that work with modifications, whether created in whole or in part by me, under the same open source license (unless I am permitted to submit under a different license), as indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it, including my sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

To sign off, add `-s` when you commit:

```bash
git commit -s -m "fix(bridge): handle empty thread ids"
```

This adds a line like `Signed-off-by: Your Name <you@example.com>`, matching your git name and email. Forgot? `git commit --amend -s` fixes the last commit, and `git rebase --signoff main` fixes all commits on your branch. A CI check (`DCO`) fails on any commit in a PR without a sign-off.

Code written with an AI agent is welcome. You're still the one signing off, so read and understand it before you do.

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests where it makes sense (see `test/`).
3. Run `npm test`.
4. Open a PR describing *why* the change is needed, not just what it does. The PR template has a short checklist.
5. Keep PRs focused: one logical change per PR.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`), with a scope where it helps (`fix(relay): ...`).

## Reporting bugs

Open a [GitHub issue](https://github.com/mrlegendary25/slopstream/issues) with steps to reproduce, your OS, Node and agent versions, and (if relevant) the matching lines from `~/.slopstream/log.jsonl` with private message text removed.

**Security issues** (anything that could let an unlinked party connect, bypass approval, or read another user's messages or token) must **not** be filed as public issues. Report them privately as described in [SECURITY.md](./SECURITY.md).

## Releasing (maintainers)

Releases are published to npm only by GitHub Actions (`.github/workflows/release.yml`), through npm trusted publishing with provenance. Nobody publishes from a laptop.

1. Update `version` in `package.json` and `.claude-plugin/plugin.json` (they must match), commit with sign-off, and merge to `main`.
2. Tag the merge commit and push the tag:
   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```
3. The workflow checks the tag matches `package.json`, runs the tests, and publishes with provenance.
4. Redeploy the hosted relay if `relay/` changed: `cd relay/cloudflare && npx wrangler deploy`.

## Code of conduct

Be respectful and constructive. Assume good intent, critique code rather than people, and help newcomers. Maintainers may remove comments or contributors that don't follow this.
