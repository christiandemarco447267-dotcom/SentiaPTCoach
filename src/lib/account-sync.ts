// Automatic cloud save for Sentia accounts (Worker backend). Each signed-in account's whole
// app state (the versioned AppState blob, plus the coach conversation) is saved to the Worker
// a few seconds after every change, when the page is hidden/closed, and again when the device
// comes back online. Saves carry the last revision this device saw, so a device can never
// silently overwrite newer progress saved from another device: the newer copy (by updatedAt)
// wins and the other one is kept in the account's backup slot (restorable in Settings).
//
// The decision logic at the top is pure and unit-tested; the store (store.tsx) drives the rest.

import { coachHistoryKey } from "./coach-history";
import { fromCloudPayload, isRemoteNewer, toCloudPayload } from "./cloud-sync";
import { AccountError, accountApi } from "./sentia-accounts";
import type { AppState } from "./types";

/** Wait this long after the last change before saving (coalesces bursts of edits). */
export const ACCOUNT_SAVE_DEBOUNCE_MS = 2500;
/** While the tab is visible, check for progress saved on another device this often. */
export const ACCOUNT_POLL_MS = 60_000;
/** After a server error (not offline), try again after this long. */
export const ACCOUNT_RETRY_MS = 30_000;
/** Mirror of the Worker's cap. */
export const ACCOUNT_STATE_MAX_BYTES = 1_000_000;
/** Browsers cap keepalive request bodies at 64 KB; bigger saves on exit rely on the device copy. */
export const KEEPALIVE_MAX_BYTES = 60_000;

// ---- pure decisions ----------------------------------------------------------------------

/** Has the guest (demo) workspace been used, or is it just the untouched starting demo? */
export function isMeaningfulGuest(state: AppState | null): boolean {
  if (!state) return false;
  if (state.profileSetupAt) return true;
  return new Date(state.updatedAt).getTime() - new Date(state.createdAt).getTime() > 1000;
}

export type InitialDecision = {
  state: AppState | null;
  /** Where the starting state came from. */
  source: "cloud" | "device" | "guest" | "fresh";
  /** Save `state` to the account right away. */
  push: boolean;
  /** Put this copy in the account's backup slot (the one that lost). */
  backup: AppState | null;
  /** The guest workspace became the account's; clear it from the device once saved. */
  carriedGuest: boolean;
};

/**
 * On sign-in (or reload), pick the account's starting state from:
 *  - cloud:   the account's saved copy (null = none yet)
 *  - pending: this account's own unsaved changes left on this device (e.g. closed while offline)
 *  - guest:   the demo workspace on this device
 * Newer wins by updatedAt; the loser is backed up, never discarded.
 */
export function decideInitialState(input: { cloud: AppState | null; pending: AppState | null; guest: AppState | null; fresh: () => AppState }): InitialDecision {
  const { cloud, pending } = input;
  const guest = isMeaningfulGuest(input.guest) ? input.guest : null;

  // This account's own unsaved edits from this device come first when they're newer.
  let base: AppState | null = cloud;
  let source: InitialDecision["source"] = "cloud";
  let push = false;
  let backup: AppState | null = null;
  if (pending && (!cloud || isRemoteNewer(pending, cloud))) {
    base = pending;
    source = "device";
    push = true;
    backup = cloud;
  }

  if (guest) {
    if (!base) return { state: guest, source: "guest", push: true, backup: null, carriedGuest: true };
    if (isRemoteNewer(guest, base)) return { state: guest, source: "guest", push: true, backup: base, carriedGuest: true };
    // The account is newer: keep it, and keep the guest copy as the backup too.
    return { state: base, source, push, backup: backup ?? guest, carriedGuest: false };
  }
  if (!base) return { state: input.fresh(), source: "fresh", push: true, backup: null, carriedGuest: false };
  return { state: base, source, push, backup, carriedGuest: false };
}

// ---- payload (state + coach conversation) ----------------------------------------------------

export type AccountPayload = ReturnType<typeof toCloudPayload> & { extras?: { coachHistory?: unknown } };

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function buildPayload(state: AppState, uid: string, storage: KV | null): AccountPayload {
  const payload: AccountPayload = toCloudPayload(state);
  try {
    const raw = storage?.getItem(coachHistoryKey(`cloud:${uid}`));
    if (raw) payload.extras = { coachHistory: JSON.parse(raw) as unknown };
  } catch {
    // unreadable history isn't worth failing a save over
  }
  return payload;
}

/** Restore the coach conversation from the account (only when this device has none for it). */
export function applyExtras(payload: unknown, uid: string, storage: KV | null): void {
  const history = (payload as { extras?: { coachHistory?: unknown } } | null)?.extras?.coachHistory;
  if (!storage || history === undefined) return;
  const key = coachHistoryKey(`cloud:${uid}`);
  try {
    if (!storage.getItem(key)) storage.setItem(key, JSON.stringify(history));
  } catch {
    // ignore
  }
}

// ---- per-account device copy (unsaved changes survive closing the tab offline) -----------------

export const pendingKey = (uid: string) => `sentia.acct.${uid}.pending`;

export function writePending(storage: KV | null, uid: string, state: AppState): void {
  try {
    storage?.setItem(pendingKey(uid), JSON.stringify(state));
  } catch {
    // quota: the in-memory copy and the next successful save still cover it
  }
}

export function readPending(storage: KV | null, uid: string): AppState | null {
  try {
    const raw = storage?.getItem(pendingKey(uid));
    return raw ? fromCloudPayload({ state: JSON.parse(raw) as unknown }) : null;
  } catch {
    return null;
  }
}

/** Clear the device copy, but only if it is the state that was just saved (a newer edit keeps it). */
export function clearPendingIfSaved(storage: KV | null, uid: string, saved: AppState): void {
  try {
    const raw = storage?.getItem(pendingKey(uid));
    if (!raw) return;
    const pending = JSON.parse(raw) as { updatedAt?: string };
    if (pending.updatedAt === saved.updatedAt) storage?.removeItem(pendingKey(uid));
  } catch {
    // ignore
  }
}

/** Everything of this account's kept on the device (removed at sign-out; the cloud copy stays). */
export function accountDeviceKeys(uid: string): string[] {
  return [pendingKey(uid), coachHistoryKey(`cloud:${uid}`)];
}

export function forgetAccountOnDevice(uid: string, stores: (KV | null)[]): void {
  for (const store of stores) {
    for (const key of accountDeviceKeys(uid)) {
      try {
        store?.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
}

// ---- server calls ---------------------------------------------------------------------------

/** Thrown by save() when another device saved newer progress: the store switches to `remote`. */
export class RemoteNewerError extends Error {
  constructor(readonly remote: AppState) {
    super("Newer progress was saved from another device.");
    this.name = "RemoteNewerError";
  }
}

export type RemoteCopy = { exists: boolean; unreadable: boolean; state: AppState | null; revision: number; payload: unknown };

const revisions = new Map<string, number>();
export const knownRevision = (uid: string) => revisions.get(uid) ?? 0;
export function resetRevision(uid: string) {
  revisions.delete(uid);
}

export async function fetchAccountState(uid: string, token: string | null): Promise<RemoteCopy> {
  const res = await accountApi<{ exists: boolean; revision: number; payload?: unknown }>("/account/state", { token });
  revisions.set(uid, res.revision ?? 0);
  if (!res.exists) return { exists: false, unreadable: false, state: null, revision: 0, payload: null };
  const state = fromCloudPayload(res.payload);
  return { exists: true, unreadable: !state, state, revision: res.revision, payload: res.payload };
}

/** Cheap check for progress saved elsewhere; null when nothing changed. */
export async function pollAccountState(uid: string, token: string | null): Promise<RemoteCopy | null> {
  const known = knownRevision(uid);
  const res = await accountApi<{ exists: boolean; unchanged?: boolean; revision: number; payload?: unknown }>(`/account/state?known=${known}`, { token });
  if (!res.exists || res.unchanged || res.revision === known) return null;
  const state = fromCloudPayload(res.payload);
  // The caller records the revision only if it adopts this copy (adoptRevision); otherwise the
  // next save still conflicts, so the other device's progress is backed up rather than lost.
  return { exists: true, unreadable: !state, state, revision: res.revision, payload: res.payload };
}

/** Record that this device now holds the copy saved at `revision`. */
export function adoptRevision(uid: string, revision: number) {
  revisions.set(uid, revision);
}

export async function saveBackup(state: AppState, uid: string, token: string | null, reason: string, storage: KV | null): Promise<void> {
  await accountApi("/account/backup", { body: { payload: buildPayload(state, uid, storage), reason }, token });
}

export type BackupInfo = { exists: boolean; updatedAt?: string; savedAt?: string; reason?: string; state?: AppState | null };

export async function fetchBackup(token: string | null): Promise<BackupInfo> {
  const res = await accountApi<{ exists: boolean; updatedAt?: string; savedAt?: string; reason?: string; payload?: unknown }>("/account/backup", { token });
  if (!res.exists) return { exists: false };
  return { exists: true, updatedAt: res.updatedAt, savedAt: res.savedAt, reason: res.reason, state: fromCloudPayload(res.payload) };
}

/**
 * Save the account's state. Resolves when saved. Throws RemoteNewerError when another device
 * saved something newer (this copy is moved to the backup slot first), AccountError otherwise.
 */
export async function saveAccountState(state: AppState, uid: string, token: string | null, storage: KV | null, opts: { keepalive?: boolean } = {}): Promise<void> {
  const payload = buildPayload(state, uid, storage);
  const body = JSON.stringify({ payload, baseRevision: knownRevision(uid) });
  if (body.length > ACCOUNT_STATE_MAX_BYTES) throw new AccountError("Your saved data is too large to sync (max 1 MB). It's still kept on this device.", 413);
  const keepalive = Boolean(opts.keepalive && body.length < KEEPALIVE_MAX_BYTES);
  try {
    const res = await accountApi<{ revision: number }>("/account/state", { body: { payload, baseRevision: knownRevision(uid) }, token, keepalive });
    revisions.set(uid, res.revision);
  } catch (error) {
    if (!(error instanceof AccountError) || error.status !== 409) throw error;
    const conflict = (error.body as { conflict?: { revision: number; payload: unknown } } | null)?.conflict;
    if (!conflict) throw error;
    const remote = fromCloudPayload(conflict.payload);
    if (!remote) {
      // Saved by a newer version of Sentia: never overwrite what this version can't read.
      throw new AccountError("Your account was saved by a newer version of Sentia. Reload the page to update; changes here are kept on this device.", 409);
    }
    if (isRemoteNewer(remote, state)) {
      revisions.set(uid, conflict.revision);
      await saveBackup(state, uid, token, "older-device-copy", storage).catch(() => undefined);
      throw new RemoteNewerError(remote);
    }
    // Ours is newer: keep theirs in the backup slot first, then save ours on top of their revision.
    await accountApi("/account/backup", { body: { payload: conflict.payload, reason: "replaced-by-newer-device" }, token });
    const res = await accountApi<{ revision: number }>("/account/state", { body: { payload, baseRevision: conflict.revision, force: true }, token });
    revisions.set(uid, res.revision);
  }
}
