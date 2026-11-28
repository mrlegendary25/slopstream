// Looks for things that look like secrets in text your agent is about to send. Pattern-based, so it misses some
// and flags some by mistake: a finding only blocks the send until a person says otherwise.
// It never returns or logs a whole match, only the first 4 characters plus "…".

const RULES = [
  { id: 'private_key', name: 'a private key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'aws_access_key', name: 'an AWS access key', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { id: 'aws_secret_key', name: 'an AWS secret key', re: /aws.{0,20}(?:secret|key).{0,5}[=:]\s*['"]?[A-Za-z0-9/+=]{40}\b/gi },
  { id: 'github_token', name: 'a GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { id: 'slack_token', name: 'a Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe_key', name: 'a Stripe key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'google_api_key', name: 'a Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'anthropic_key', name: 'an Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai_key', name: 'an OpenAI API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, skip: (m) => m.startsWith('sk-ant-') },
  { id: 'npm_token', name: 'an npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'slopstream_token', name: 'a Slopstream login token', re: /\bsst_[A-Za-z0-9_-]{40,}/g },
  { id: 'jwt', name: 'a JSON web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: 'url_credentials', name: 'a password inside a URL', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@/g },
];

// NAME = value, where the name says "secret", "token", "password" and so on. A bare variable NAME is never a finding.
const ASSIGN_RE = /\b[A-Za-z0-9_.-]*?(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|APIKEY|PRIVATE[_-]?KEY|CREDENTIAL)S?(?![A-Za-z])[A-Za-z0-9_.-]*\s*[=:]\s*["']?([^\s"']{8,})/gi;
const PLACEHOLDER = /^(?:<|\$\{|\$\(|\$[A-Z_]+$|process\.env|os\.environ|os\.getenv|x{3,}|\*{3,}|\.{3,}|changeme|change[-_]me|your[-_]|example|redacted|null$|none$|undefined|true$|false$)/i;
const CODEY = /[(){}[\]<>;]/;

const ASSIGN_RULE = { id: 'secret_assignment', name: 'a secret value set in a variable' };
const ENTROPY_RULE = { id: 'high_entropy', name: 'a long random-looking string (likely a key)' };

export const RULE_IDS = [...RULES.map(r => r.id), ASSIGN_RULE.id, ENTROPY_RULE.id];
export const RULE_NAMES = Object.fromEntries([...RULES, ASSIGN_RULE, ENTROPY_RULE].map(r => [r.id, r.name]));

const shannon = (s) => {
  const n = new Map(); for (const c of s) n.set(c, (n.get(c) || 0) + 1);
  let h = 0; for (const v of n.values()) { const p = v / s.length; h -= p * Math.log2(p); }
  return h;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Internal: every finding with its position. Callers outside this file only get previews.
function findAll(text) {
  const out = [];
  const add = (rule, index, len) => out.push({ rule, index, len });
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) if (!(r.skip && r.skip(m[0]))) add(r.id, m.index, m[0].length);
  }
  for (const m of text.matchAll(ASSIGN_RE)) {
    const v = m[1];
    if (PLACEHOLDER.test(v) || CODEY.test(v)) continue;
    add('secret_assignment', m.index + m[0].length - v.length, v.length);
  }
  // Long random-looking runs. Hex (git SHAs, hashes) and UUIDs are not keys; a run inside a URL is a path, not a key.
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{32,}/g)) {
    const s = m[0];
    if (/^[0-9a-fA-F]+$/.test(s) || UUID.test(s)) continue;
    const before = text.slice(Math.max(0, m.index - 200), m.index);
    const wordStart = before.search(/\S*$/);
    if (/:\/\//.test(before.slice(wordStart))) continue; // inside a URL
    if ((s.match(/\//g) || []).length >= 2) continue;     // looks like a file path
    if (!(/[a-z]/.test(s) && (/[A-Z]/.test(s) || /\d/.test(s)))) continue; // one character class only: not a key
    if (shannon(s) >= 4.5) add('high_entropy', m.index, s.length);
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// [{ rule, name, line, preview }], one per rule per line. Never the whole match.
export function scanSecrets(text) {
  const t = String(text || '');
  const seen = new Set(); const res = [];
  for (const f of findAll(t)) {
    const line = lineOf(t, f.index);
    const k = `${f.rule}:${line}`;
    if (seen.has(k)) continue; seen.add(k);
    res.push({ rule: f.rule, name: RULE_NAMES[f.rule], line, preview: t.slice(f.index, f.index + 4) + '…' });
  }
  return res.sort((a, b) => a.line - b.line);
}

// For logs: the same text with every finding replaced by its preview.
export function redactSecrets(text) {
  const t = String(text || '');
  const found = findAll(t).sort((a, b) => a.index - b.index);
  let out = '', pos = 0;
  for (const f of found) {
    if (f.index < pos) continue; // overlapping findings: the earlier one already covered it
    out += t.slice(pos, f.index) + t.slice(f.index, f.index + 4) + '…[redacted]';
    pos = f.index + f.len;
  }
  return out + t.slice(pos);
}

// "this looks like an AWS access key (line 3) and a GitHub token (line 5)"
export function describeFindings(findings) {
  const parts = [...new Map(findings.map(f => [f.rule, f])).values()].slice(0, 4)
    .map(f => `${f.name} (line ${f.line})`);
  return parts.join(' and ');
}
