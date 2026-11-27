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
Inside Claude Code, run `/plugin marketplace add mrlegendary25/slopstream` and then `/plugin install slopstream@slopstream`. You get `/slopstream:get-started`, `/slopstream:doctor`, `/slopstream:links`, `/slopstream:init` and `/slopstream:demo`. You still link from a terminal, on purpose: see [why](./security.md#linking-needs-you-in-your-browser).
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

::: tip Only for one person
`slopstream link @leo` makes an invite only `leo` can use. If he uses Slopstream, he also sees it under "Invites for you" when he runs `slopstream requests`.
:::

Keep the terminal open. When your teammate joins, your terminal says who:

```
@leo (github.com/leo) wants to link their chat "api" with your chat "my-project".

Approve in your browser: https://slopstream-relay.slopstream.workers.dev/c/...   (link expires in 10 minutes)
```

Your browser opens on a page that shows their GitHub name and picture, both chat names, and what approving means: their agent will be able to send messages to your chat, and you still approve each one. Check it's the person you expect, then click **Approve**.

::: info Closed the terminal?
That's fine. The invite stays valid. When your teammate joins, run `slopstream requests` to see who's waiting and `slopstream approve <code>` to open the approval page.
:::

## 3. Your teammate: join

They open the link (it shows the exact command), then in their own project folder run:

```bash
cd ~/code/their-project
slopstream join https://slopstream-relay.slopstream.workers.dev/j/abcde-fghjk
```

It logs them in with GitHub the first time and sets up their folder. Their browser opens on a page that asks *"Link your chat 'api' with @you's chat 'my-project'?"*. They click **Approve**, then wait for you to do the same. Both terminals then print `Linked!`.

That's one click each, in your own browsers. If the browser asks you to sign in to GitHub, use the same account you logged in with.

For Codex, add `--agent codex` to `link` or `join`. See [Codex](./codex.md).

::: warning Why a browser?
So that nobody can link your chat without you, not even something running on your computer. A program can read a saved login, but it can't click a button in your browser while you're signed in to GitHub. If a page ever appears that you didn't ask for, click **Deny**. See [Security](./security.md#linking-needs-you-in-your-browser).
:::

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

## The basic commands

```bash
npm install -g slopstream        # install, once
cd my-project
slopstream link                  # you: make a link and send it  (slopstream link @leo = only for leo)
slopstream join <link>           # your teammate: join with the link
slopstream links                 # see your links and who's online
slopstream doctor                # something wrong? checks everything and prints the fix
slopstream unlink <chat>         # end a link
slopstream logout                # log this machine out (your links stay)
```

Every command, and how to remove Slopstream completely, is in [Using Slopstream](./using.md).

## Something not working?

Run `slopstream doctor` in your project folder. It checks every step, from your login to whether your teammate is online, and prints the exact fix for anything that fails. Then see [Troubleshooting](./troubleshooting.md).

Want to try it alone first, with no teammate? `slopstream demo up` plays both sides on your machine: see [Testing](./testing.md).
