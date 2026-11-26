// Client for Sentia accounts served by the Cloudflare Worker (used when Firebase isn't configured).
//
// Sessions are bearer tokens (the site is a static export on another origin, so no cookies):
//   - "Remember me" checked   → 30-day session, kept in localStorage (survives closing the browser)
//   - "Remember me" unchecked → 12-hour session, kept in sessionStorage only (gone when the tab closes)
//
// The top half of this file is framework-free and unit-tested; the bottom half talks to the API.

import { apiUrl } from "./api-config";

export const SESSION_KEY = "sentia.session";

export type PublicAccount = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  hasPassword: boolean;
  providers: ("google" | "apple")[];
  passkeys: { id: string; name: string; createdAt: string; lastUsedAt?: string }[];
};

export type StoredSession = { token: string; expiresAt: number; remember: boolean; account: PublicAccount };

/** Minimal Storage surface (localStorage / sessionStorage / a test double). */
export type SimpleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SessionStores = { local: SimpleStorage | null; session: SimpleStorage | null };

function parseSession(raw: string | null, now: number): StoredSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredSession;
    if (typeof s?.token !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(s.token)) return null;
    if (typeof s.expiresAt !== "number" || s.expiresAt <= now) return null;
    if (!s.account || typeof s.account.id !== "string" || typeof s.account.email !== "string") return null;
    return s;
  } catch {
    return null;
  }
}

/** The saved session, if any and not expired. A tab-only session wins over a remembered one. */
export function readStoredSession(stores: SessionStores, now = Date.now()): StoredSession | null {
  for (const store of [stores.session, stores.local]) {
    if (!store) continue;
    try {
      const raw = store.getItem(SESSION_KEY);
      const s = parseSession(raw, now);
      if (s) return s;
      if (raw) store.removeItem(SESSION_KEY); // expired or corrupt
    } catch {
      // storage blocked
    }
  }
  return null;
}

/** Save the session where "Remember me" says, and make sure no copy is left in the other place. */
export function writeStoredSession(stores: SessionStores, s: StoredSession): void {
  const [keep, drop] = s.remember ? [stores.local, stores.session] : [stores.session, stores.local];
  try {
    drop?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  try {
    keep?.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Storage full/blocked: the session still works for this page view.
  }
}

export function clearStoredSession(stores: SessionStores): void {
  for (const store of [stores.local, stores.session]) {
    try {
      store?.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * What to call the device's built-in authenticator. Face ID and Touch ID can't be told apart
 * from the browser on iPhone/iPad, so Apple phones/tablets get both names.
 */
export function biometricLabel(env: { userAgent: string; platform?: string; maxTouchPoints?: number }): { name: string; signIn: string; turnOn: string; apple: boolean } {
  const ua = env.userAgent || "";
  const platform = env.platform || "";
  const iPadOS = /Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return { name: "Face ID / Touch ID", signIn: "Sign in with Face ID / Touch ID", turnOn: "Turn on Face ID / Touch ID", apple: true };
  if (/Mac/.test(platform) || /Macintosh/.test(ua)) return { name: "Touch ID", signIn: "Sign in with Touch ID", turnOn: "Turn on Touch ID", apple: true };
  if (/Win/.test(platform) || /Windows/.test(ua)) return { name: "Windows Hello", signIn: "Sign in with Windows Hello", turnOn: "Turn on Windows Hello", apple: false };
  return { name: "passkey / fingerprint", signIn: "Use passkey / fingerprint", turnOn: "Turn on passkey / fingerprint sign-in", apple: false };
}

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/** A friendly strength hint (not a gate: the only hard rules are length and not-your-email). */
export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "" };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  else if (/\d|[^A-Za-z0-9]/.test(pw) && pw.length >= 10) score += 0.5;
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwerty)/i.test(pw)) score = 0;
  const s = Math.max(0, Math.min(4, Math.floor(score))) as Strength["score"];
  return { score: s, label: ["Too weak", "Weak", "Fair", "Good", "Strong"][s] ?? "" };
}

/** Client-side check matching the Worker's rules, so most mistakes are caught before a request. */
export function passwordError(pw: string, email: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 128) return "Use at most 128 characters.";
  if (email && pw.trim().toLowerCase() === email.trim().toLowerCase()) return "Your password can't be your email address.";
  if (/^(.)\1+$/.test(pw)) return "Pick a password that isn't one repeated character.";
  return null;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// ---- API client ---------------------------------------------------------------------

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

/** A network failure (offline, DNS, CORS) rather than an answer from the server. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof AccountError ? error.status === 0 : error instanceof TypeError;
}

export async function accountApi<T = Record<string, unknown>>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; token?: string | null; keepalive?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      keepalive: init.keepalive,
      signal: init.signal,
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new AccountError("Can't reach Sentia right now. Check your connection and try again.", 0);
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = typeof body?.error === "string" ? body.error : res.status === 429 ? "Too many attempts. Please wait a minute." : "Something went wrong. Please try again.";
    throw new AccountError(message, res.status, body);
  }
  return (body ?? {}) as T;
}

// ---- session store (module singleton, read with useSyncExternalStore) ----------------------

export type SessionSnapshot = { status: "loading" | "ready"; session: StoredSession | null };

let snapshot: SessionSnapshot = { status: "loading", session: null };
const listeners = new Set<() => void>();
let started = false;

function browserStores(): SessionStores {
  const safe = <T,>(get: () => T): T | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  if (typeof window === "undefined") return { local: null, session: null };
  return { local: safe(() => window.localStorage), session: safe(() => window.sessionStorage) };
}

function set(next: SessionSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getSessionSnapshot = () => snapshot;
const SERVER_SNAPSHOT: SessionSnapshot = { status: "loading", session: null };
export const getServerSessionSnapshot = () => SERVER_SNAPSHOT;

export function currentToken(): string | null {
  return snapshot.session?.token ?? null;
}

/** Called once on mount: restore the saved session, then confirm it with the server. */
export function startSentiaSession(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const saved = readStoredSession(browserStores());
  set({ status: "ready", session: saved });
  if (!saved) return;
  void accountApi<{ account: PublicAccount }>("/auth/me", { token: saved.token })
    .then(({ account }) => {
      if (snapshot.session?.token !== saved.token) return;
      const next = { ...saved, account };
      writeStoredSession(browserStores(), next);
      set({ status: "ready", session: next });
    })
    .catch((error: unknown) => {
      // Offline: keep the saved session so the account's unsaved changes can still sync later.
      if (error instanceof AccountError && error.status === 401 && snapshot.session?.token === saved.token) {
        clearStoredSession(browserStores());
        set({ status: "ready", session: null });
      }
    });
  // Another tab signed in or out (remembered sessions only; tab sessions are per tab by design).
  window.addEventListener("storage", (event) => {
    if (event.key !== SESSION_KEY) return;
    const now = readStoredSession(browserStores());
    if (now?.token !== snapshot.session?.token) set({ status: "ready", session: now });
  });
}

type SessionResponse = { token: string; expiresAt: number; remember: boolean; account: PublicAccount };

function adopt(res: SessionResponse): PublicAccount {
  const session: StoredSession = { token: res.token, expiresAt: res.expiresAt, remember: res.remember, account: res.account };
  writeStoredSession(browserStores(), session);
  set({ status: "ready", session });
  return res.account;
}

export async function signUpWithPassword(input: { email: string; password: string; name: string; remember: boolean }): Promise<PublicAccount> {
  return adopt(await accountApi<SessionResponse>("/auth/signup", { body: input }));
}

export async function signInWithPassword(input: { email: string; password: string; remember: boolean }): Promise<PublicAccount> {
  return adopt(await accountApi<SessionResponse>("/auth/signin", { body: input }));
}

export function updateAccount(account: PublicAccount): void {
  const s = snapshot.session;
  if (!s) return;
  const next = { ...s, account };
  writeStoredSession(browserStores(), next);
  set({ status: "ready", session: next });
}

/** End the session on the server (best effort) and forget it on this device. */
export async function endSentiaSession(): Promise<void> {
  const token = currentToken();
  clearStoredSession(browserStores());
  set({ status: "ready", session: null });
  if (token) await accountApi("/auth/signout", { method: "POST", body: {}, token }).catch(() => undefined);
}

/** Delete the account and its cloud save on the server. Accounts with a password must re-enter it. */
export async function deleteSentiaAccount(password: string): Promise<void> {
  await accountApi("/auth/delete", { body: { password }, token: currentToken() });
  clearStoredSession(browserStores());
  set({ status: "ready", session: null });
}

// ---- passkeys (Face ID / Touch ID / fingerprint / Windows Hello) ----------------------------

/** True when this browser can sign in with the device's built-in biometric authenticator. */
export async function platformPasskeyAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  if (process.env.NEXT_PUBLIC_APP_TARGET === "native") return false; // needs Associated Domains first (STORE_RELEASE.md)
  const PKC = window.PublicKeyCredential as (typeof PublicKeyCredential & { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> }) | undefined;
  if (!PKC?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function currentBiometricLabel() {
  if (typeof navigator === "undefined") return biometricLabel({ userAgent: "" });
  return biometricLabel({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
}

/** The user cancelled the system prompt (not an error worth shouting about). */
export function isPasskeyCancel(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

export async function signInWithPasskey(remember: boolean): Promise<PublicAccount> {
  const { startAuthentication } = await import("@simplewebauthn/browser");
  const { challengeId, options } = await accountApi<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/passkey/login/options", { body: {} });
  const response = await startAuthentication({ optionsJSON: options });
  return adopt(await accountApi<SessionResponse>("/auth/passkey/login/verify", { body: { challengeId, response, remember } }));
}

export async function registerPasskey(name: string): Promise<PublicAccount> {
  const token = currentToken();
  const { startRegistration } = await import("@simplewebauthn/browser");
  const { challengeId, options } = await accountApi<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/passkey/register/options", { body: {}, token });
  const response = await startRegistration({ optionsJSON: options });
  const { account } = await accountApi<{ account: PublicAccount }>("/auth/passkey/register/verify", { body: { challengeId, response, name }, token });
  updateAccount(account);
  try {
    localStorage.setItem(devicePasskeyKey(account.id), response.id);
  } catch {
    // ignore
  }
  return account;
}

/** Which of the account's passkeys was created on this device (so Settings can show an on/off switch). */
export const devicePasskeyKey = (uid: string) => `sentia.passkey-device.${uid}`;
export function devicePasskeyId(uid: string): string | null {
  try {
    return localStorage.getItem(devicePasskeyKey(uid));
  } catch {
    return null;
  }
}

export async function removePasskey(id: string): Promise<PublicAccount> {
  const { account } = await accountApi<{ account: PublicAccount }>("/auth/passkey/remove", { body: { id }, token: currentToken() });
  updateAccount(account);
  return account;
}

/** Remember on this device that we already offered Face ID / Touch ID to this account. */
export const PASSKEY_OFFER_KEY = "sentia.passkey-offered";
export function passkeyOffered(uid: string): boolean {
  try {
    return (localStorage.getItem(PASSKEY_OFFER_KEY) ?? "").split(",").includes(uid);
  } catch {
    return true;
  }
}
export function markPasskeyOffered(uid: string): void {
  try {
    const list = (localStorage.getItem(PASSKEY_OFFER_KEY) ?? "").split(",").filter(Boolean);
    if (!list.includes(uid)) localStorage.setItem(PASSKEY_OFFER_KEY, [...list.slice(-19), uid].join(","));
  } catch {
    // ignore
  }
}

// ---- Google / Apple ------------------------------------------------------------------------

export async function oauthNonce(): Promise<{ nonceId: string; nonce: string }> {
  return accountApi<{ nonceId: string; nonce: string }>("/auth/oauth/nonce", { body: {} });
}

export async function signInWithIdToken(input: { provider: "google" | "apple"; idToken: string; nonceId: string; remember: boolean; name?: string }): Promise<PublicAccount> {
  return adopt(await accountApi<SessionResponse>("/auth/oauth/verify", { body: input }));
}
