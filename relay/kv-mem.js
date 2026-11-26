// In-memory KV for unit tests. Same contract as FileKV (see dev plan §2.1): synchronous, JSON values.
export class MemKV {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); this.audit = []; }
  get(k) { const v = this.m.get(k); return v === undefined ? undefined : structuredClone(v); }
  put(k, v) { this.m.set(k, structuredClone(v)); }
  del(k) { this.m.delete(k); }
  list(p) { return [...this.m].filter(([k]) => k.startsWith(p)).map(([k, v]) => [k, structuredClone(v)]); }
  appendAudit(o) { this.audit.push(o); }
}
