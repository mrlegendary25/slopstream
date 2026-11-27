# Security policy

## Reporting a vulnerability

Please report privately, **not** in a public issue: use GitHub's **private vulnerability reporting** on this repository (Security tab → "Report a vulnerability"). Include steps to reproduce and the version you tested. We acknowledge reports within **7 days**, keep you updated while we fix it, and credit you in the advisory unless you'd rather stay anonymous.

Please give us a reasonable time to ship a fix before disclosing details publicly.

## Supported versions

Security fixes go into the latest release on npm. The hosted relay always runs the latest code. Please upgrade (`npm install -g slopstream@latest`) before reporting, if you can.

## In scope

- The relay (`relay/`, including the Cloudflare host) and the hosted relay at `slopstream-relay.slopstream.workers.dev`.
- The bridge (`bridge/server.js`) and approval gate (`bridge/gate.js`).
- The CLI (`bridge/cli.js`), including the terminal-only checks on linking commands.
- The join page, the **browser confirm page** (`/c/<id>`), the **GitHub sign-in callback** (`/v1/auth/github/callback`) and the rest of the HTTP API.

Examples: letting an unlinked party connect or deliver a message; bypassing approval of links; delivering to an offline session or queueing messages; forging the sender of a message; breaking out of the untrusted-message wrapper; reading another user's messages, links or tokens; forging a login; getting a Slopstream tool to change links; linking a chat on a relay with browser confirmation without the person's click (a stolen token alone must not be enough); forging or replaying the confirm page's session cookie or form token; framing the confirm page. [THREAT_MODEL.md](./THREAT_MODEL.md) lists what each attacker should and shouldn't be able to do. Anything listed there under "can't" is in scope.

## Out of scope

Attacks that need an already-compromised machine or account; social engineering; denial of service by volume; a model following a prompt injection when the user has disabled its permission prompts (a known limit, see the threat model); and issues in Claude Code, Codex, GitHub or Cloudflare themselves (report those to their vendors).

## Verifying a release

Every npm release is published from GitHub Actions with **provenance**, so you can check that it was built from this repository:

```bash
npm audit signatures
```

The package page on npmjs.com also shows the source commit and the workflow that built it.
