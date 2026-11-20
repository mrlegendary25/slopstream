# Setup (fast path)

Minimum commands to get linked. No explanations, no optional steps — if something breaks or you want to know *why*, see [README.md](./README.md) and [TESTING.md](./TESTING.md). Requires macOS, Node 20+, Claude Code ≥2.1.80.

One person is the **host** (runs the relay). Everyone else is a **joiner**. Do Part 1 as everyone, then Part 2 (host) or Part 3 (joiner) as your role.

---

## 1. Everyone

- **Claude Code**, logged in with a claude.ai account:
  ```bash
  claude --version   # need >= 2.1.80; if missing: curl -fsSL https://claude.ai/install.sh | bash
  ```
- **Tailscale**: download from <https://tailscale.com/download>, open it, sign in with your own account (not shared). Note the `100.x.x.x` address it gives you.

---

## 2. Host

Get Slopstream — pick one:

```bash
# Option A: Claude Code plugin (run inside a Claude Code session, then in a terminal)
/plugin marketplace add mrlegendary25/slopstream
/plugin install slopstream@slopstream
# run /slopstream:get-started in that session — it prints the install path. Then, in a terminal:
cd <path-it-printed> && npm install && npm link
```
```bash
# Option B: clone it yourself (terminal only)
git clone https://github.com/mrlegendary25/slopstream.git && cd slopstream && npm install && npm link
```

Share your Tailscale machine with each joiner: <https://console.tailscale.com/admin/machines> → **⋯** on your machine → **Share** → send them the invite link.

```bash
DATA_DIR=~/.slopstream-relay node relay/admin.js add-user <you>
DATA_DIR=~/.slopstream-relay node relay/admin.js add-user <joiner>   # repeat per joiner
HOST=<your-tailscale-ip> DATA_DIR=~/.slopstream-relay caffeinate -i node relay/server.js
```
(leave that running — open a new terminal for the rest)

```bash
slopstream setup ws://<your-tailscale-ip>:8787 <you> <your-token>
slopstream pair-create projX
```
Send the joiner the code it prints; type `y` when they accept.

```bash
cd ~/path/to/your/project
slopstream init projX
claude --dangerously-load-development-channels server:slopstream
```

---

## 3. Joiner

Accept the Tailscale invite link the host sent you.

Get Slopstream — pick one:

```bash
# Option A: Claude Code plugin (run inside a Claude Code session, then in a terminal)
/plugin marketplace add mrlegendary25/slopstream
/plugin install slopstream@slopstream
# run /slopstream:get-started in that session — it prints the install path. Then, in a terminal:
cd <path-it-printed> && npm install && npm link
```
```bash
# Option B: clone it yourself (terminal only)
git clone https://github.com/mrlegendary25/slopstream.git && cd slopstream && npm install && npm link
```

```bash
slopstream setup ws://<host-tailscale-ip>:8787 <you> <your-token>
slopstream pair-accept <code-from-host> projX
```

```bash
cd ~/path/to/your/project
slopstream init projX
claude --dangerously-load-development-channels server:slopstream
```

---

**Check it worked (either side):** inside Claude, type `Use link_status.` → expect `peerOnline: true`.

**Adding a 3rd person:** host runs `slopstream invite projX` instead of `pair-create`; the new person still runs `pair-accept` as above (up to `MAX_GROUP_SIZE`, default 3).
