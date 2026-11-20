// Small helpers for talking to the relay as a human-operated "admin" connection
// (pairing, listing, unlinking). Used by the CLI, the demo and the tests.
import WebSocket from 'ws';

export function admin(cfg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(cfg.relay);
    ws.once('error', (e) => reject(new Error(`cannot reach relay ${cfg.relay}: ${e.message}`)));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', user: cfg.user, token: cfg.token })));
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') { ws.off('message', onMsg); resolve(ws); }
      else if (m.t === 'error') reject(new Error(`${m.code}: ${m.message}`));
    };
    ws.on('message', onMsg);
  });
}

export const nextMsg = (ws, types, timeoutMs = 0) => new Promise((resolve, reject) => {
  let timer = null;
  const h = (raw) => {
    const m = JSON.parse(raw.toString());
    if (types.includes(m.t) || m.t === 'error') {
      ws.off('message', h); if (timer) clearTimeout(timer);
      m.t === 'error' ? reject(new Error(`${m.code}: ${m.message}`)) : resolve(m);
    }
  };
  ws.on('message', h);
  if (timeoutMs) timer = setTimeout(() => { ws.off('message', h); reject(new Error(`timed out waiting for ${types.join('/')}`)); }, timeoutMs);
});

// Pair chatA (cfgA) with chatB (cfgB) without any human prompt. Used ONLY by the local demo and tests,
// where both identities belong to the same person on the same machine.
export async function pairBoth(cfgA, chatA, cfgB, chatB) {
  const wsA = await admin(cfgA); const wsB = await admin(cfgB);
  try {
    wsA.send(JSON.stringify({ t: 'pair_create', chat: chatA }));
    const { code } = await nextMsg(wsA, ['pair_code'], 5000);
    const reqP = nextMsg(wsA, ['pair_request'], 5000);
    const pairedA = nextMsg(wsA, ['paired', 'pair_denied'], 5000);
    const pairedB = nextMsg(wsB, ['paired', 'pair_denied'], 5000);
    wsB.send(JSON.stringify({ t: 'pair_accept', code, chat: chatB }));
    const req = await reqP;
    wsA.send(JSON.stringify({ t: 'pair_decision', code: req.code, ok: true }));
    const [a, b] = await Promise.all([pairedA, pairedB]);
    if (a.t !== 'paired' || b.t !== 'paired') throw new Error('pairing was denied');
    return a.link;
  } finally { wsA.close(); wsB.close(); }
}

// Add chatNew (cfgNew) to the EXISTING group that chatInviter (cfgInviter) already belongs to, without any
// human prompt. Used ONLY by the local demo and tests, where all identities belong to the same person.
export async function inviteAndAccept(cfgInviter, chatInviter, cfgNew, chatNew) {
  const wsI = await admin(cfgInviter); const wsN = await admin(cfgNew);
  try {
    wsI.send(JSON.stringify({ t: 'invite_create', chat: chatInviter }));
    const { code } = await nextMsg(wsI, ['pair_code'], 5000);
    const reqP = nextMsg(wsI, ['pair_request'], 5000);
    const pairedI = nextMsg(wsI, ['paired', 'pair_denied'], 5000);
    const pairedN = nextMsg(wsN, ['paired', 'pair_denied'], 5000);
    wsN.send(JSON.stringify({ t: 'pair_accept', code, chat: chatNew }));
    const req = await reqP;
    wsI.send(JSON.stringify({ t: 'pair_decision', code: req.code, ok: true }));
    const [a, b] = await Promise.all([pairedI, pairedN]);
    if (a.t !== 'paired' || b.t !== 'paired') throw new Error('invite was denied');
    return a.link;
  } finally { wsI.close(); wsN.close(); }
}

export async function listLinks(cfg) {
  const ws = await admin(cfg);
  try { ws.send(JSON.stringify({ t: 'list_links' })); return (await nextMsg(ws, ['links'], 5000)).links; }
  finally { ws.close(); }
}
