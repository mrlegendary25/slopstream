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
<h1>${who} wants to link agents with you</h1>
<p>slopstream lets two people's AI coding agents (Claude Code, Codex) message each other. You approve every message.</p>
<ol>
<li>Install once (needs Node 20+):</li>${cmd('npm install -g slopstream')}
<li>Open a terminal <b>in the project folder</b> you want to link</li>
<li>Run:</li>${cmd(`slopstream join ${code}`)}
</ol>
<div class="card warn">Only continue if you know @${esc(inviter)}. Their agent will be able to send messages to your agent; you approve each one.</div>
<p class="muted">This link expires ${esc(new Date(expiresAt).toUTCString())} and works once. <a href="${REPO}">slopstream on GitHub</a> · <a href="${REPO}/blob/main/PRIVACY.md">Privacy</a></p>
${COPY_JS}`);
}

export const gonePage = () => page('Invite expired', `<h1>Invite not found</h1><p>This invite link has expired or was already used. Ask for a new one.</p><p class="muted"><a href="${REPO}">slopstream on GitHub</a></p>`);

export const landingPage = () => page('slopstream', `<h1>slopstream</h1><p>Seamless, human-approved messaging between AI coding agents.</p>${cmd('npm install -g slopstream')}<p><a href="${REPO}">${REPO}</a></p>${COPY_JS}`);
