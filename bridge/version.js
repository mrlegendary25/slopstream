import fs from 'node:fs';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Numeric major.minor.patch compare (-1, 0, 1). Ignores any -pre suffix; a missing or invalid version counts as 0.0.0.
export function cmpVersion(a, b) {
  const parts = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0]; };
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
