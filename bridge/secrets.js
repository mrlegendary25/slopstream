// Keeps the login token out of a plain dotfile: macOS Keychain, Windows DPAPI, Linux libsecret.
// Built for injection (`run`, `platform`, `env`) so the tests never touch a real keychain.
//
// What this does NOT do: stop your own agent. Anything running as you can ask the same keychain for the token
// (docs/security.md). It protects against dotfile backups and sync, a stray `cat` on a shared screen, and other users.
// The thing that stops a tricked agent from linking your chat is the browser confirmation.
import { spawnSync } from 'node:child_process';

const SECRET_RE = /^[A-Za-z0-9_-]{16,200}$/;  // every slopstream token matches; anything else is refused, so stdin can't be injected into
const ACCOUNT_RE = /^[A-Za-z0-9._@#:-]{1,200}$/;
const WIN_PROTECT = "Add-Type -AssemblyName System.Security; $s = [Console]::In.ReadToEnd().Trim(); $b = [Text.Encoding]::UTF8.GetBytes($s); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))";
const WIN_UNPROTECT = "Add-Type -AssemblyName System.Security; $s = [Console]::In.ReadToEnd().Trim(); $b = [Convert]::FromBase64String($s); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))";

export function defaultRun(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 10000 });
  return { status: r.error ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// set(account, secret) -> { blob? }   (DPAPI returns the encrypted blob; the caller keeps it in config.json)
// get(account, blob?) -> string | null
export function makeSecretStore({ platform = process.platform, run = defaultRun, env = process.env } = {}) {
  const file = { kind: 'file', available: () => false, set() { throw new Error('no secret store'); }, get: () => null, del() {} };
  if (env.SLOPSTREAM_KEYCHAIN === 'off') return file;
  const checkSecret = (s) => { if (!SECRET_RE.test(String(s))) throw new Error('refusing to store a secret with unexpected characters'); };
  const checkAccount = (a) => { if (!ACCOUNT_RE.test(String(a))) throw new Error('refusing an unexpected account name'); };

  if (platform === 'darwin') {
    return {
      kind: 'keychain',
      available: () => run('security', ['help']).status !== null,
      set(account, secret) {
        checkAccount(account); checkSecret(secret);
        // The secret goes in on stdin, never argv: `ps` shows other users every argument.
        const r = run('security', ['-i'], `add-generic-password -U -s slopstream -a "${account}" -w ${secret}\n`);
        if (r.status !== 0) throw new Error(`keychain refused the write (${(r.stderr || '').trim().slice(0, 120)})`);
        return {};
      },
      get(account) {
        checkAccount(account);
        const r = run('security', ['find-generic-password', '-s', 'slopstream', '-a', account, '-w']);
        return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
      },
      del(account) { checkAccount(account); run('security', ['delete-generic-password', '-s', 'slopstream', '-a', account]); },
    };
  }
  if (platform === 'win32') {
    const exe = env.SLOPSTREAM_PWSH || 'powershell.exe';
    const ps = (script, input) => run(exe, ['-NoProfile', '-NonInteractive', '-Command', script], input);
    return {
      kind: 'dpapi',
      available: () => ps('exit 0').status === 0,
      set(account, secret) {
        checkAccount(account); checkSecret(secret);
        const r = ps(WIN_PROTECT, secret);
        const blob = r.stdout.trim();
        if (r.status !== 0 || !/^[A-Za-z0-9+/=]+$/.test(blob)) throw new Error('DPAPI could not protect the token');
        return { blob };
      },
      get(account, blob) {
        if (!blob || !/^[A-Za-z0-9+/=]+$/.test(blob)) return null;
        const r = ps(WIN_UNPROTECT, blob);
        return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
      },
      del() {}, // nothing outside config.json to delete
    };
  }
  if (platform === 'linux') {
    return {
      kind: 'libsecret',
      available() {
        if (run('secret-tool', ['--version']).status === null) return false; // not installed
        // A lookup of a missing item exits 1 with no output; with no D-Bus session it also complains on stderr.
        const r = run('secret-tool', ['lookup', 'service', 'slopstream', 'account', 'probe']);
        return r.status === 0 || (r.status === 1 && !r.stderr.trim());
      },
      set(account, secret) {
        checkAccount(account); checkSecret(secret);
        const r = run('secret-tool', ['store', '--label=slopstream', 'service', 'slopstream', 'account', account], secret);
        if (r.status !== 0) throw new Error('libsecret refused the write');
        return {};
      },
      get(account) {
        checkAccount(account);
        const r = run('secret-tool', ['lookup', 'service', 'slopstream', 'account', account]);
        return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
      },
      del(account) { checkAccount(account); run('secret-tool', ['clear', 'service', 'slopstream', 'account', account]); },
    };
  }
  return file;
}
