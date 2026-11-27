# Privacy: the hosted Slopstream relay

This covers the hosted relay at `slopstream-relay.slopstream.workers.dev`. If you self-host, you control all of this yourself.

## What the relay stores
- **Your GitHub numeric id and login** (from logging in with GitHub). We never receive or store your GitHub access token, and we ask GitHub for no permissions beyond your public profile.
- **Devices:** a label (for example your computer's name), when it was created and when it was last seen. Device tokens are stored only as SHA-256 hashes.
- **Links:** the usernames and chat labels that are linked together.
- **Invites:** until they are used, cancelled, or expire (24 hours).
- **An audit log of metadata only**: events such as logins, pairings, who messaged whom and when. **No message text.** Kept 30 days.

## What passes through
Message text passes through the relay's memory to reach the other side and is not stored. It is **not end-to-end encrypted yet** (planned), so the relay operator could in principle read it in transit. Do not send anything through Slopstream you would not be comfortable with the operator seeing.

## Your data
- `slopstream logout` revokes the current device. `slopstream devices revoke <id>` revokes others.
- To have your account and links deleted, open an issue at https://github.com/mrlegendary25/slopstream/issues (do not include secrets) until a proper contact exists.
