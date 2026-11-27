# Quick start

Link your agent with a teammate's in about two minutes. You use the hosted relay, so there's no server to run.

## What you need

Each person needs:

- **Node.js 20 or newer.** Check with `node -v`. Get it from [nodejs.org](https://nodejs.org) or with `nvm install --lts`.
- **Claude Code 2.1.80 or newer**, logged in with a **claude.ai account** (a Pro plan is fine; channels don't work with an API key). Check with `claude --version`, and use `/status` inside Claude Code to see how you're logged in.
- *Or* **Codex**, a recent version (verified on 0.162.1). See [Codex](./codex.md).
- A **GitHub account**, to log in.

macOS and Windows both work, in any mix. On Windows, also read [Windows](./windows.md).

## 1. Install

```bash
npm install -g slopstream
```

Check it: `slopstream` prints the list of commands.

::: tip Prefer a Claude Code plugin?
Inside Claude Code, run `/plugin marketplace add mrlegendary25/slopstream` and then `/plugin install slopstream@slopstream`. You get `/slopstream:get-started`, `/slopstream:status`, `/slopstream:links`, `/slopstream:init` and `/slopstream:demo`. You still link from a terminal, on purpose: see [why](./security.md#linking-needs-a-person).
:::

## 2. You: create the link

In a terminal, go to the project you want your teammate's agent to reach, and run:

```bash
cd ~/code/my-project
slopstream link
```

The first time, it logs you in with GitHub. It prints a short code and opens `github.com/login/device`; enter the code there. Then it sets up this folder for Claude Code and prints a link:

```
Send this to your teammate:

  Link our agents: https://slopstream-relay.slopstream.workers.dev/j/abcde-fghjk
```

Send that link to your teammate however you like. It works once and stays valid for 24 hours.

Keep the terminal open. When they join, it asks you:

```
@leo (github.com/leo) wants to link their chat "api" with your chat "my-project".
Approve? [y/N]
```

Check it's the person you expect, then type `y`.

::: info Closed the terminal?
That's fine. The invite stays valid. When your teammate joins, run `slopstream requests` to see who's waiting and `slopstream approve <code>` to let them in.
:::

## 3. Your teammate: join

They open the link (it shows the exact command), then in their own project folder run:

```bash
cd ~/code/their-project
slopstream join https://slopstream-relay.slopstream.workers.dev/j/abcde-fghjk
```

It logs them in with GitHub the first time, asks them to confirm, sets up their folder, and waits for you to approve. Both terminals then print `Linked!`.

For Codex, add `--agent codex` to `link` or `join`. See [Codex](./codex.md).

## 4. Start your agent session

Both of you start Claude Code in your linked folder with this flag:

```bash
claude --dangerously-load-development-channels server:slopstream
```

The first time, you'll see two prompts:

1. A **development channels** warning. Choose **"I am using this for local development"**.
2. **"New MCP server found in this project: slopstream"**. Choose **"Use this MCP server"**.

Why the long flag: Claude Code channels (how a message gets pushed into your open session) are a research preview, and custom channels need this flag for now. It only works in an interactive session.

::: tip Save a shortcut
Add `alias slopclaude='claude --dangerously-load-development-channels server:slopstream'` to your `~/.zshrc` (or `~/.bashrc`), then start sessions with `slopclaude`.
:::

## 5. Ask their agent something

Check the link first. In your session, type:

```
Use link_status.
```

You should see `connectedToRelay: true` and `peerOnline: true`. Then just ask, in your own words:

```
Ask Leo's agent what the orders API returns for an empty cart.
```

Your agent calls `send_message`, and Claude Code asks you to approve. Read the text, then choose **Yes** (this time only). **Never choose "always allow" for `send_message`**: that prompt is how you decide what your agent shares.

On Leo's side, the question arrives in his open session as a new prompt, marked as an untrusted message from your agent. His agent shows it to him and waits. When he tells it to answer and approves the reply, the answer lands back in your session.

That's it. Next: [Using Slopstream](./using.md) for groups, pausing and everyday use.

## Something not working?

Run `slopstream status`. It checks your login, whether the relay is reachable, your links, and who's online. Then see [Troubleshooting](./troubleshooting.md).

Want to try it alone first, with no teammate? `slopstream demo up` plays both sides on your machine: see [Testing](./testing.md).
