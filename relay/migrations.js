// Schema versioning for the relay's stored data. Each entry upgrades the store by one version.
// Never edit or reorder an entry that has shipped: add a new one at the end.
export const MIGRATIONS = [
  // 1: baseline, the state as of 0.2.x (users, links, account:, gh:, device:, invite:, devauth:)
  (kv) => {},
];

// Runs every pending migration in order and records the schema number after EACH one, so a crash
// part-way resumes at the right step. Refuses to touch data written by a newer slopstream.
export function migrate(kv, list = MIGRATIONS) {
  const cur = kv.get('schema') || 0;
  if (cur > list.length) throw new Error(`relay data is from a newer slopstream (schema ${cur})`);
  for (let i = cur; i < list.length; i++) {
    list[i](kv);
    kv.put('schema', i + 1);
  }
}
