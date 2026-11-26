import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAccountProvider, resolveSocialConfig } from "./account-provider";
import {
  accountDeviceKeys,
  applyExtras,
  buildPayload,
  clearPendingIfSaved,
  decideInitialState,
  forgetAccountOnDevice,
  isMeaningfulGuest,
  pendingKey,
  readPending,
  writePending,
} from "./account-sync";
import { coachHistoryKey } from "./coach-history";
import {
  biometricLabel,
  clearStoredSession,
  looksLikeEmail,
  passwordError,
  passwordStrength,
  readStoredSession,
  SESSION_KEY,
  writeStoredSession,
  type StoredSession,
} from "./sentia-accounts";
import { createInitialState } from "./storage";
import type { AppState } from "./types";

class MemStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);
const account = { id: "u_abcdefghijklmnopqrst", email: "ana@example.com", name: "", createdAt: "2026-11-26T15:00:00.000Z", hasPassword: true, providers: [], passkeys: [] };
const session = (remember: boolean, expiresAt = NOW + 3600_000): StoredSession => ({ token: "t".repeat(43), expiresAt, remember, account });

test("account provider: Firebase wins, else the Sentia API (unless switched off)", () => {
  assert.equal(resolveAccountProvider({ firebase: true, apiUrl: "https://api.example" }), "firebase");
  assert.equal(resolveAccountProvider({ firebase: false, apiUrl: "https://sentia-api.sentiacoach.workers.dev" }), "sentia");
  assert.equal(resolveAccountProvider({ firebase: false, apiUrl: "" }), "sentia", "falls back to the built-in api.sentiacoach.com");
  assert.equal(resolveAccountProvider({ firebase: false, apiUrl: undefined }), "sentia");
  assert.equal(resolveAccountProvider({ firebase: false, apiUrl: "https://api.example", sentiaAccounts: "off" }), "none");
});

test("Google / Apple buttons only appear when configured, and never in the native build", () => {
  assert.deepEqual(resolveSocialConfig({}), { google: "", apple: null });
  const full = resolveSocialConfig({ googleClientId: "123-abc.apps.googleusercontent.com", appleServicesId: "com.sentiacoach.web", appleRedirectUri: "https://sentiacoach.com/signin/" });
  assert.equal(full.google, "123-abc.apps.googleusercontent.com");
  assert.deepEqual(full.apple, { servicesId: "com.sentiacoach.web", redirectUri: "https://sentiacoach.com/signin/" });
  assert.equal(resolveSocialConfig({ googleClientId: "not a client id" }).google, "");
  assert.equal(resolveSocialConfig({ appleServicesId: "com.x", appleRedirectUri: "http://insecure" }).apple, null);
  assert.deepEqual(resolveSocialConfig({ googleClientId: "123-abc.apps.googleusercontent.com", target: "native" }), { google: "", apple: null });
});

test("Remember me: 30-day sessions go to localStorage, tab sessions to sessionStorage only", () => {
  const local = new MemStorage();
  const tab = new MemStorage();
  const stores = { local, session: tab };
  writeStoredSession(stores, session(true));
  assert.ok(local.getItem(SESSION_KEY));
  assert.equal(tab.getItem(SESSION_KEY), null);
  assert.equal(readStoredSession(stores, NOW)?.remember, true);

  writeStoredSession(stores, session(false));
  assert.equal(local.getItem(SESSION_KEY), null, "switching to a tab session removes the remembered one");
  assert.ok(tab.getItem(SESSION_KEY));
  assert.equal(readStoredSession(stores, NOW)?.remember, false);

  clearStoredSession(stores);
  assert.equal(readStoredSession(stores, NOW), null);
});

test("expired or corrupt saved sessions are ignored and removed", () => {
  const local = new MemStorage();
  writeStoredSession({ local, session: null }, session(true, NOW - 1));
  assert.equal(readStoredSession({ local, session: null }, NOW), null);
  assert.equal(local.getItem(SESSION_KEY), null);
  local.setItem(SESSION_KEY, "{not json");
  assert.equal(readStoredSession({ local, session: null }, NOW), null);
  local.setItem(SESSION_KEY, JSON.stringify({ ...session(true), token: "short" }));
  assert.equal(readStoredSession({ local, session: null }, NOW), null);
});

test("biometric label by platform", () => {
  assert.equal(biometricLabel({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }).signIn, "Sign in with Face ID / Touch ID");
  assert.equal(biometricLabel({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 }).name, "Face ID / Touch ID", "iPadOS reports as a Mac with touch");
  assert.equal(biometricLabel({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 }).signIn, "Sign in with Touch ID");
  assert.equal(biometricLabel({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32" }).name, "Windows Hello");
  assert.equal(biometricLabel({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)" }).signIn, "Use passkey / fingerprint");
});

test("password rules and strength hint", () => {
  assert.equal(passwordError("short", ""), "Use at least 8 characters.");
  assert.match(passwordError("ana@example.com", "Ana@Example.com") ?? "", /email/);
  assert.match(passwordError("zzzzzzzzzz", "") ?? "", /repeated/);
  assert.equal(passwordError("a fine passphrase", "ana@example.com"), null);
  assert.equal(passwordStrength("").label, "");
  assert.equal(passwordStrength("password123").score, 0);
  assert.ok(passwordStrength("Correct-Horse-9-Battery").score >= 3);
  assert.ok(passwordStrength("abcdefgh").score < passwordStrength("abcdefghIJKL").score);
  assert.ok(looksLikeEmail(" a@b.co "));
  assert.ok(!looksLikeEmail("a@b"));
});

// ---- cloud save decisions ---------------------------------------------------------------

const at = (base: AppState, iso: string, patch: Partial<AppState> = {}): AppState => ({ ...base, ...patch, updatedAt: iso });

test("an untouched demo workspace doesn't count as guest progress", () => {
  const fresh = createInitialState();
  assert.equal(isMeaningfulGuest(fresh), false);
  assert.equal(isMeaningfulGuest(at(fresh, new Date(Date.parse(fresh.createdAt) + 60_000).toISOString())), true);
  assert.equal(isMeaningfulGuest({ ...fresh, profileSetupAt: fresh.createdAt }), true);
  assert.equal(isMeaningfulGuest(null), false);
});

test("first sign-in with guest progress and an empty account carries the guest data in", () => {
  const base = createInitialState();
  const guest = at(base, "2030-01-01T00:00:00.000Z");
  const d = decideInitialState({ cloud: null, pending: null, guest, fresh: createInitialState });
  assert.equal(d.source, "guest");
  assert.equal(d.state, guest);
  assert.equal(d.push, true);
  assert.equal(d.carriedGuest, true);
  assert.equal(d.backup, null);
});

test("both exist: the newer copy wins and the other is backed up", () => {
  const base = createInitialState();
  const cloud = at(base, "2030-01-02T00:00:00.000Z", { profileName: "Cloud" });
  const olderGuest = at(base, "2030-01-01T00:00:00.000Z", { profileName: "Guest" });
  const keepCloud = decideInitialState({ cloud, pending: null, guest: olderGuest, fresh: createInitialState });
  assert.equal(keepCloud.state, cloud);
  assert.equal(keepCloud.push, false);
  assert.equal(keepCloud.backup, olderGuest, "the older guest copy is kept as the account's backup");
  assert.equal(keepCloud.carriedGuest, false, "guest data that stayed guest isn't removed from the device");

  const newerGuest = at(base, "2030-01-03T00:00:00.000Z", { profileName: "Guest" });
  const keepGuest = decideInitialState({ cloud, pending: null, guest: newerGuest, fresh: createInitialState });
  assert.equal(keepGuest.state, newerGuest);
  assert.equal(keepGuest.push, true);
  assert.equal(keepGuest.backup, cloud);
  assert.equal(keepGuest.carriedGuest, true);
});

test("an untouched demo never replaces an account's progress", () => {
  const cloud = at(createInitialState(), "2020-01-01T00:00:00.000Z");
  const fresh = createInitialState(); // newer timestamps, but untouched
  const d = decideInitialState({ cloud, pending: null, guest: fresh, fresh: createInitialState });
  assert.equal(d.state, cloud);
  assert.equal(d.backup, null);
  assert.equal(d.push, false);
});

test("this account's unsaved device changes (e.g. closed while offline) are pushed when newer", () => {
  const base = createInitialState();
  const cloud = at(base, "2030-01-01T00:00:00.000Z");
  const pending = at(base, "2030-01-01T00:05:00.000Z", { profileName: "Edited offline" });
  const d = decideInitialState({ cloud, pending, guest: null, fresh: createInitialState });
  assert.equal(d.state, pending);
  assert.equal(d.source, "device");
  assert.equal(d.push, true);
  assert.equal(d.backup, cloud);
  // ...but not when another device has saved something newer since.
  const stale = decideInitialState({ cloud: at(base, "2030-01-02T00:00:00.000Z"), pending, guest: null, fresh: createInitialState });
  assert.equal(stale.source, "cloud");
});

test("a brand-new account with no guest progress starts from a fresh demo and saves it", () => {
  const d = decideInitialState({ cloud: null, pending: null, guest: null, fresh: createInitialState });
  assert.equal(d.source, "fresh");
  assert.ok(d.state);
  assert.equal(d.push, true);
});

test("payload carries the coach conversation; restore only fills an empty device", () => {
  const uid = "u_abcdefghijklmnopqrst";
  const local = new MemStorage();
  const history = { v: 1, updatedAt: 1, messages: [{ role: "user", text: "hi" }] };
  local.setItem(coachHistoryKey(`cloud:${uid}`), JSON.stringify(history));
  const payload = buildPayload(createInitialState(), uid, local);
  assert.deepEqual(payload.extras?.coachHistory, history);
  assert.equal(payload.state.version, payload.schemaVersion);

  const other = new MemStorage();
  applyExtras(payload, uid, other);
  assert.deepEqual(JSON.parse(other.getItem(coachHistoryKey(`cloud:${uid}`)) ?? "null"), history);
  other.setItem(coachHistoryKey(`cloud:${uid}`), "\"mine\"");
  applyExtras(payload, uid, other);
  assert.equal(other.getItem(coachHistoryKey(`cloud:${uid}`)), "\"mine\"");
});

test("device copy of unsaved changes: written, cleared only once that exact state is saved, wiped at sign-out", () => {
  const uid = "u_abcdefghijklmnopqrst";
  const store = new MemStorage();
  const a = at(createInitialState(), "2030-01-01T00:00:00.000Z");
  const b = at(a, "2030-01-01T00:00:03.000Z");
  writePending(store, uid, b);
  assert.equal(readPending(store, uid)?.updatedAt, b.updatedAt);
  clearPendingIfSaved(store, uid, a);
  assert.ok(store.getItem(pendingKey(uid)), "an older save doesn't clear a newer pending change");
  clearPendingIfSaved(store, uid, b);
  assert.equal(store.getItem(pendingKey(uid)), null);

  const local = new MemStorage();
  local.setItem("sentia.state.v2", "guest data");
  for (const k of accountDeviceKeys(uid)) local.setItem(k, "x");
  forgetAccountOnDevice(uid, [local, null]);
  assert.deepEqual([...local.map.keys()], ["sentia.state.v2"], "guest data that wasn't the account's stays");
});
