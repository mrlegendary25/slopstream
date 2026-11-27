// A tiny fake of GitHub's OAuth device flow, for tests. No network beyond localhost.
import http from 'node:http';

export async function startFakeGitHub(port) {
  let n = 0;
  const byUserCode = new Map();   // user_code -> {deviceCode, state:'pending'|'ok'|'denied', account, token}
  const byDeviceCode = new Map();
  const byToken = new Map();      // access_token -> {id, login}
  const webCodes = new Map();     // authorization code (browser flow) -> account
  let browserUser = null;         // who the simulated browser is signed in as (null: not signed in)
  let wc = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const form = Object.fromEntries(new URLSearchParams(body));
      if (req.method === 'POST' && req.url === '/login/device/code') {
        n++;
        const e = { deviceCode: `dc-${n}`, userCode: `UC${n}-TEST`, state: 'pending' };
        byUserCode.set(e.userCode, e); byDeviceCode.set(e.deviceCode, e);
        return send(200, { device_code: e.deviceCode, user_code: e.userCode, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
      }
      // Browser (web application) flow: the person is already signed in as `browserUser`; GitHub bounces straight back.
      if (req.method === 'GET' && req.url.startsWith('/login/oauth/authorize?')) {
        const q = new URL(req.url, 'http://x').searchParams;
        if (!browserUser) return send(403, { error: 'not signed in' });
        const code = `wc-${++wc}`; webCodes.set(code, browserUser);
        const back = new URL(q.get('redirect_uri')); back.searchParams.set('code', code); back.searchParams.set('state', q.get('state'));
        res.writeHead(302, { location: back.toString() }); return res.end();
      }
      if (req.method === 'POST' && req.url === '/login/oauth/access_token' && form.code) {
        const acc = webCodes.get(form.code);
        if (form.client_secret !== 'test-secret' || !acc) return send(200, { error: 'bad_verification_code' });
        webCodes.delete(form.code); // single use
        const t = `gho-web-${form.code}`; byToken.set(t, acc);
        return send(200, { access_token: t, token_type: 'bearer' });
      }
      if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
        const e = byDeviceCode.get(form.device_code);
        if (!e) return send(200, { error: 'expired_token' });
        if (e.state === 'pending') return send(200, { error: 'authorization_pending' });
        if (e.state === 'denied') return send(200, { error: 'access_denied' });
        return send(200, { access_token: e.token, token_type: 'bearer' });
      }
      if (req.method === 'GET' && req.url === '/user') {
        const acc = byToken.get((req.headers.authorization || '').replace(/^Bearer /, ''));
        return acc ? send(200, acc) : send(401, { message: 'Bad credentials' });
      }
      send(404, {});
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${port}`,
    authorize(userCode, account) {
      const e = byUserCode.get(userCode); e.state = 'ok'; e.token = `gho-${e.deviceCode}`; byToken.set(e.token, account);
    },
    setBrowserUser(account) { browserUser = account; },
    deny(userCode) { byUserCode.get(userCode).state = 'denied'; },
    close() { server.close(); server.closeAllConnections?.(); },
  };
}
