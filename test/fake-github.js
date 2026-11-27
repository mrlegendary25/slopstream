// A tiny fake of GitHub's OAuth device flow, for tests. No network beyond localhost.
import http from 'node:http';

export async function startFakeGitHub(port) {
  let n = 0;
  const byUserCode = new Map();   // user_code -> {deviceCode, state:'pending'|'ok'|'denied', account, token}
  const byDeviceCode = new Map();
  const byToken = new Map();      // access_token -> {id, login}

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
    deny(userCode) { byUserCode.get(userCode).state = 'denied'; },
    close() { server.close(); server.closeAllConnections?.(); },
  };
}
