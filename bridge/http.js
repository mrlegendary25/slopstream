// Tiny fetch helpers for the relay's HTTP API (same host and port as the WebSocket).

export function httpBase(relayUrl) {
  return String(relayUrl).replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/+$/, '');
}

async function call(url, init) {
  let r;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new Error(`cannot reach relay ${url}: ${e.message}`); }
  let j = {};
  try { j = await r.json(); } catch { /* non-JSON error page */ }
  j.httpStatus = r.status;
  return j;
}

export const getJson = (url) => call(url, { headers: { accept: 'application/json' } });
export const postJson = (url, body) => call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
