// Per-account cloud save: the app's whole versioned state blob, one copy per account,
// plus a single "other copy" backup slot used when two devices disagree.
//
//   acct:state:<uid>   → StateRecord JSON  (revision increases by 1 on every save)
//   acct:backup:<uid>  → BackupRecord JSON (the copy that lost a conflict; restorable in Settings)
//
// Writes are compare-and-set on `revision` so a device can't silently overwrite newer data
// saved by another device: a stale save gets 409 + the current copy and the app decides.
// KV is eventually consistent across locations (up to ~60 s), so this is a strong guard
// for the common case, not a distributed lock.

export const STATE_MAX_BYTES = 1_000_000;

export type StatePayload = { schemaVersion: number; updatedAt: string; state: Record<string, unknown>; extras?: Record<string, unknown> };
export type StateRecord = { revision: number; updatedAt: string; savedAt: string; payload: StatePayload };
export type BackupRecord = { updatedAt: string; savedAt: string; reason: string; payload: StatePayload };

const stateKey = (uid: string) => `acct:state:${uid}`;
const backupKey = (uid: string) => `acct:backup:${uid}`;

/** Light structural check: the app validates the full schema itself when it loads the copy. */
export function validatePayload(raw: unknown): StatePayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const state = p.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const s = state as Record<string, unknown>;
  if (typeof s.version !== "number" || typeof s.updatedAt !== "string" || Number.isNaN(Date.parse(s.updatedAt))) return null;
  const extras = p.extras && typeof p.extras === "object" && !Array.isArray(p.extras) ? (p.extras as Record<string, unknown>) : undefined;
  return { schemaVersion: s.version, updatedAt: s.updatedAt, state: s, ...(extras ? { extras } : {}) };
}

async function readJsonKey<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const readState = (kv: KVNamespace, uid: string) => readJsonKey<StateRecord>(kv, stateKey(uid));
export const readBackup = (kv: KVNamespace, uid: string) => readJsonKey<BackupRecord>(kv, backupKey(uid));

export type SaveResult =
  | { ok: true; revision: number; savedAt: string }
  | { ok: false; conflict: StateRecord };

/**
 * Save if `baseRevision` matches what's stored (0 = "I believe there's no copy yet").
 * `force` overwrites a mismatched copy but first moves it to the backup slot, so nothing is lost.
 */
export async function saveState(kv: KVNamespace, uid: string, payload: StatePayload, baseRevision: number, force: boolean, now: number): Promise<SaveResult> {
  const existing = await readState(kv, uid);
  const currentRevision = existing?.revision ?? 0;
  if (existing && currentRevision !== baseRevision) {
    if (!force) return { ok: false, conflict: existing };
    await writeBackup(kv, uid, existing.payload, "replaced-by-newer-device", now);
  }
  const record: StateRecord = { revision: currentRevision + 1, updatedAt: payload.updatedAt, savedAt: new Date(now).toISOString(), payload };
  await kv.put(stateKey(uid), JSON.stringify(record));
  return { ok: true, revision: record.revision, savedAt: record.savedAt };
}

export async function writeBackup(kv: KVNamespace, uid: string, payload: StatePayload, reason: string, now: number): Promise<BackupRecord> {
  const record: BackupRecord = { updatedAt: payload.updatedAt, savedAt: new Date(now).toISOString(), reason: reason.slice(0, 40), payload };
  await kv.put(backupKey(uid), JSON.stringify(record));
  return record;
}

export async function deleteAccountState(kv: KVNamespace, uid: string): Promise<void> {
  await kv.delete(stateKey(uid));
  await kv.delete(backupKey(uid));
}
