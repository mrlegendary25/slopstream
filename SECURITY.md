# Security policy

## Reporting a vulnerability
Please report privately, not in a public issue: use GitHub's **private vulnerability reporting** on this repository (Security tab → "Report a vulnerability"). Include steps to reproduce and the version you tested. We will acknowledge your report within **7 days**.

## In scope
The relay (`relay/`, including the Cloudflare host), the bridge (`bridge/server.js`), the CLI (`bridge/cli.js`), and the join page. Examples: letting an unlinked party connect, bypassing the human approval gates, linking chats without a human, reading another user's messages or tokens, forging a login.

## Out of scope
Attacks that need an already-compromised machine or account, social engineering, denial of service by volume, and issues in Claude Code, Codex, GitHub or Cloudflare themselves (report those to their vendors).
