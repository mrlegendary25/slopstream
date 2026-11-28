// Making another agent's text safe to put in front of your agent: strip what could hide or forge things, then frame it
// so every line of it is visibly the peer's, and none of it can pass as the bridge's own words.

// The patterns are built from numbers, not typed as escapes, so no editor or tool can turn an escape into the invisible character itself.
const u = (n) => '\\u' + n.toString(16).padStart(4, '0');
const cls = (ranges) => ranges.map(([a, b]) => (a === b ? u(a) : `${u(a)}-${u(b)}`)).join('');
// Control characters (not tab or newline), zero-width and bidi controls, and the line and paragraph separators.
const HIDDEN = new RegExp(`[${cls([[0, 8], [0xB, 0xC], [0xE, 0x1F], [0x7F, 0x7F], [0x200B, 0x200F], [0x2028, 0x2029], [0x202A, 0x202E], [0x2066, 0x2069]])}]`, 'g');
// Lone surrogate halves (they print as broken characters and can split a line invisibly).
const LONE_HIGH = new RegExp(`[${cls([[0xD800, 0xDBFF]])}](?![${cls([[0xDC00, 0xDFFF]])}])`, 'g');
const LONE_LOW = new RegExp(`(?<![${cls([[0xD800, 0xDBFF]])}])[${cls([[0xDC00, 0xDFFF]])}]`, 'g');

export function sanitize(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')                    // a lone CR would overwrite the line in some terminals
    .replace(LONE_HIGH, '').replace(LONE_LOW, '')
    .replace(HIDDEN, '')
    .replace(/</g, String.fromCharCode(0xFF1C)).replace(/>/g, String.fromCharCode(0xFF1E));
}

export const FRAME = String.fromCharCode(0x2502) + ' ';

// Every line starts with the frame, so a line that begins "[slopstream]" or "[UNTRUSTED" is plainly inside the peer's text.
export const frameBody = (body) => String(body).split('\n').map((l) => FRAME + l).join('\n');
