// Opt-in: stores, reads back and deletes a dummy secret in the REAL keychain of this OS.
// Not part of `npm test` or CI. Run: SLOPSTREAM_TEST_REAL_KEYCHAIN=1 node test/keychain-smoke.js
import crypto from 'node:crypto';
import { makeSecretStore } from '../bridge/secrets.js';

if (process.env.SLOPSTREAM_TEST_REAL_KEYCHAIN !== '1') { console.log('skipped (set SLOPSTREAM_TEST_REAL_KEYCHAIN=1 to run against the real keychain)'); process.exit(0); }
const store = makeSecretStore({ env: {} });
console.log(`store kind: ${store.kind}, available: ${store.available()}`);
if (store.kind === 'file' || !store.available()) { console.log('FAIL no keychain available on this machine'); process.exit(1); }
const account = `smoke-test@localhost#${crypto.randomBytes(6).toString('hex')}`;
const secret = 'sst_' + crypto.randomBytes(32).toString('base64url');
let ok = false;
try {
  const { blob } = store.set(account, secret);
  ok = store.get(account, blob) === secret;
  console.log(ok ? 'PASS  stored and read back' : 'FAIL  read back did not match');
} finally { store.del(account); }
const gone = store.kind === 'dpapi' || store.get(account) === null;
console.log(gone ? 'PASS  deleted' : 'FAIL  still present after delete');
process.exit(ok && gone ? 0 : 1);
