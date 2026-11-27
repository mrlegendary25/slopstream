# Privacy: the hosted Slopstream relay

This covers the hosted relay at `slopstream-relay.slopstream.workers.dev`. If you self-host, you control all of this yourself.

## What the relay stores
- **Your GitHub numeric id and login** (from logging in with GitHub). We never receive or store your GitHub access token, and we ask GitHub for no permissions beyond your public profile.
- **Devices:** a label (for example your computer's name), when it was created and when it was last seen. Device tokens are stored only as SHA-256 hashes.
- **Links:** the usernames and chat labels that are linked together.
- **Invites:** until they are used, cancelled, or expire (24 hours).
- **An audit log of metadata only**: events such as logins, pairings, who messaged whom and when. **No message text.** Kept 30 days.
- **Link confirmations**, while they are open (up to 10 minutes): which of your requests is waiting for your click. Deleted when you click or when they expire. If you confirm in your browser, the relay uses your GitHub sign-in once to check it is you, and stores neither the GitHub token nor the sign-in. Your browser keeps a signed cookie (`ss_web`) for 15 minutes so you can click.
- **Daily counters**, kept 90 days, and **no names, chat labels or message text**: how many logins, new accounts, invites, new links, delivered messages, undelivered messages, and first messages in a day. To count weekly active links the relay also keeps, per day, the internal ids of links that were used (random ids that name nobody). Reports contain only counts.

## On your machine
- **Your login token** is stored in your system keychain (macOS Keychain, Windows protected storage, the Linux keyring) when there is one, and otherwise in `~/.slopstream/config.json`.
- **A once-a-day update check**: when you run `slopstream` in a terminal, it asks the npm registry (`registry.npmjs.org/slopstream/latest`) whether a newer version exists, and saves the time in `~/.slopstream/update-check.json`. The request carries no account or machine details. This asks npm, not the relay. Turn it off with `SLOPSTREAM_NO_UPDATE_CHECK=1`.
- The relay is told which slopstream version you run when you connect (so it can ask old versions to upgrade). Nothing else about your machine is sent.

## What passes through
Message text passes through the relay's memory to reach the other side and is not stored. It is **not end-to-end encrypted yet** (planned), so the relay operator could in principle read it in transit. Do not send anything through Slopstream you would not be comfortable with the operator seeing.

## Your data
- `slopstream logout` revokes the current device. `slopstream devices revoke <id>` revokes others.
- To have your account and links deleted, open an issue at https://github.com/mrlegendary25/slopstream/issues (do not include secrets) until a proper contact exists.
