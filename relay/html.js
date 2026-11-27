// HTML for the join page and the landing page. Pure functions; every interpolated value goes through esc().
const REPO = 'https://github.com/mrlegendary25/slopstream';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{color-scheme:light dark;--bg:#fafafa;--fg:#1a1a1a;--muted:#666;--card:#fff;--line:#ddd;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#9a9a9a;--card:#1e1e1e;--line:#333;--accent:#8ab4f8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px}
h1{font-size:1.4rem;margin:0 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
.cmd{display:flex;gap:8px;align-items:center;justify-content:space-between}
code{font:14px ui-monospace,Menlo,Consolas,monospace;word-break:break-all}
button{font:inherit;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
.warn{border-color:#d9a400}.muted{color:var(--muted);font-size:.9rem}a{color:var(--accent)}
img{border-radius:50%;vertical-align:middle;margin-right:8px}`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;

const COPY_JS = `<script>document.querySelectorAll('button[data-c]').forEach(function(b){b.onclick=function(){navigator.clipboard.writeText(b.dataset.c).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)})}})</script>`;

const cmd = (c) => `<div class="card cmd"><code>${esc(c)}</code><button data-c="${esc(c)}">Copy</button></div>`;

export function invitePage({ inviter, inviterGithub, code, expiresAt }) {
  const who = inviterGithub
    ? `<img src="https://avatars.githubusercontent.com/${esc(inviterGithub)}?s=64" width="32" height="32" alt=""><a href="https://github.com/${esc(inviterGithub)}">@${esc(inviter)}</a>`
    : `@${esc(inviter)}`;
  return page(`Link agents with @${inviter}`, `
<h1>${who} wants your agents to be able to ask each other</h1>
<p>Slopstream lets your agent consult @${esc(inviter)}'s agent directly (Claude Code, Codex), instead of you two copy-pasting between them. You approve every message.</p>
<ol>
<li>Install once (needs Node 20+):</li>${cmd('npm install -g slopstream')}
<li>Open a terminal <b>in the project folder</b> you want to link</li>
<li>Run:</li>${cmd(`slopstream join ${code}`)}
</ol>
<div class="card warn">Only continue if you know @${esc(inviter)}. Their agent will be able to send messages to your agent; you approve each one.</div>
<p class="muted">This link expires ${esc(new Date(expiresAt).toUTCString())} and works once. <a href="${REPO}">slopstream on GitHub</a> · <a href="${REPO}/blob/main/PRIVACY.md">Privacy</a></p>
${COPY_JS}`);
}

export const gonePage = ({ what } = {}) => page(what === 'request' ? 'Request expired' : 'Invite expired', `<h1>${what === 'request' ? 'Request not found' : 'Invite not found'}</h1><p>${what === 'request' ? 'This confirmation link has expired or was already used. Run the command in your terminal again.' : 'This invite link has expired or was already used. Ask for a new one.'}</p><p class="muted"><a href="${REPO}">slopstream on GitHub</a></p>`);

export const landingPage = () => page('slopstream', `<h1>slopstream</h1><p>Your agent can ask mine. Let AI agents consult each other directly, with each person in control.</p>${cmd('npm install -g slopstream')}<p><a href="${REPO}">${REPO}</a></p>${COPY_JS}`);

const person = ({ user, github }) => github
  ? `<img src="https://avatars.githubusercontent.com/${esc(github)}?s=64" width="32" height="32" alt=""><a href="https://github.com/${esc(github)}">@${esc(github)}</a> <span class="muted">(github.com/${esc(github)})</span>`
  : `@${esc(user)}`;

// The page a person lands on after running `slopstream join` / `approve`. One click per side.
export function confirmPage({ action, other, theirChat, myChat, id, csrf }) {
  const q = action === 'accept'
    ? `<h1>Link your chat '${esc(myChat)}' with @${esc(other.user)}'s chat '${esc(theirChat)}'?</h1>
<div class="card">${person(other)}</div>
<p>@${esc(other.user)}'s agent will be able to send messages to this chat. You approve each one.</p>`
    : `<h1>${person(other)} wants to link their chat '${esc(theirChat)}' with your chat '${esc(myChat)}'</h1>
<p>If you approve, their agent will be able to send messages to this chat. You approve each one.</p>`;
  return page('Approve link', `${q}
<div class="card warn">Only approve if you just ran <code>slopstream link</code>, <code>join</code> or <code>approve</code> yourself. If you didn't, click Deny: something on your computer may be trying to link your chat.</div>
<form method="post" action="/c/${esc(id)}">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>
<p class="muted"><a href="${REPO}/blob/main/PRIVACY.md">Privacy</a></p>`);
}

export const messagePage = (title, text) => page(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p><p class="muted"><a href="${REPO}">slopstream on GitHub</a></p>`);
