// Sentia accounts: email + password sign-up/sign-in, bearer-token sessions, and the
// building blocks the passkey (Face ID / Touch ID) and cloud-save routes share.
//
// Storage (all in SENTIA_KV):
//   acct:email:<sha256(email)>  → user id                (lookup by email, raw email never used as a key)
//   acct:user:<id>              → UserRecord JSON        (password hash + passkeys)
//   acct:cred:<credentialId>    → user id                (passkey sign-in lookup)
//   acct:sess:<sha256(token)>   → SessionRecord JSON     (expires with the session via KV TTL)
//   acct:fail:<sha256(email)>   → failed sign-in counter  (15-minute lockout window)
//   (email verification + password reset records: see email-verify.ts)
//
// Email verification: accounts created with email + password start with emailVerified=false and
// get no session until the address is confirmed. Accounts created before verification existed
// have no emailVerified field and count as verified ("grandfathered"), so nobody is locked out.
// Unverified records carry a KV TTL (UNVERIFIED_TTL_S) and are also purged lazily after 7 days.
//
// Passwords: PBKDF2-SHA256 with a random 16-byte salt per user. Cloudflare Workers cap PBKDF2
// at 100,000 iterations, so that is what we use; the count is stored with each hash so it can
// be raised later without breaking existing accounts. Session tokens are 32 random bytes; only
// their SHA-256 hash is stored, so a KV leak doesn't hand out live sessions.

import type { Env } from "./env";

export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_REMEMBER_S = 30 * 24 * 3600; // "Remember me": 30 days
export const SESSION_SHORT_S = 12 * 3600; // unchecked: 12 hours
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const EMAIL_MAX = 254;
export const NAME_MAX = 60;
export const MAX_FAILED_SIGNINS = 10;
export const FAIL_WINDOW_S = 15 * 60;
/** Unverified sign-ups older than this are deleted the next time anyone touches them. */
export const UNVERIFIED_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** KV safety net: unverified records expire on their own a day after the lazy-purge age. */
export const UNVERIFIED_TTL_S = 8 * 24 * 3600;

export type PasswordHash = { alg: "pbkdf2-sha256"; iter: number; salt: string; hash: string };

export type StoredPasskey = {
  /** base64url credential id */
  id: string;
  /** base64url COSE public key */
  publicKey: string;
  counter: number;
  transports?: string[];
  name: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  /** Absent for accounts created with Google / Apple only. */
  password?: PasswordHash;
  passkeys: StoredPasskey[];
  /** Linked sign-in providers: provider → that provider's stable user id (`sub`). */
  providers?: Partial<Record<"google" | "apple", string>>;
  /** false = signed up with email + password and hasn't confirmed the address yet. Absent = verified (incl. grandfathered accounts). */
  emailVerified?: boolean;
  /** Sessions created before this time (ms) are no longer accepted (set by a password reset). */
  sessionsValidAfter?: number;
};

export type SessionRecord = { uid: string; exp: number; remember: boolean; createdAt: number };

export type PublicAccount = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  hasPassword: boolean;
  emailVerified: boolean;
  providers: ("google" | "apple")[];
  passkeys: { id: string; name: string; createdAt: string; lastUsedAt?: string }[];
};

// ---- encoding helpers --------------------------------------------------------

export function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two byte arrays (length difference is folded in, no early exit). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ---- validation -----------------------------------------------------------------

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > EMAIL_MAX) return null;
  // Pragmatic check: one @, something on both sides, a dot in the domain, no spaces.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function validatePassword(raw: unknown, email?: string): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Enter a password." };
  if (raw.length < PASSWORD_MIN) return { ok: false, error: `Use at least ${PASSWORD_MIN} characters.` };
  if (raw.length > PASSWORD_MAX) return { ok: false, error: `Use at most ${PASSWORD_MAX} characters.` };
  if (email && raw.trim().toLowerCase() === email) return { ok: false, error: "Your password can't be your email address." };
  if (/^(.)\1+$/.test(raw)) return { ok: false, error: "Pick a password that isn't one repeated character." };
  return { ok: true, password: raw };
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Strip control characters and collapse whitespace.
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

// ---- passwords ----------------------------------------------------------------

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return { alg: "pbkdf2-sha256", iter: iterations, salt: toB64url(salt), hash: toB64url(hash) };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const derived = await pbkdf2(password, fromB64url(stored.salt), stored.iter);
  return bytesEqual(derived, fromB64url(stored.hash));
}

// A fixed decoy so a sign-in for an unknown email costs the same PBKDF2 work as a real one
// (no timing signal that tells an attacker whether the account exists).
const DECOY_HASH: PasswordHash = { alg: "pbkdf2-sha256", iter: PBKDF2_ITERATIONS, salt: "c2VudGlhLWRlY295LXNhbHQ", hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DECOY_HASH);
}

// ---- KV records ----------------------------------------------------------------

const emailKey = async (email: string) => `acct:email:${await sha256Hex(email)}`;
const userKey = (id: string) => `acct:user:${id}`;
export const credKey = (credentialId: string) => `acct:cred:${credentialId}`;
const sessKey = async (token: string) => `acct:sess:${await sha256Hex(token)}`;
const failKey = async (email: string) => `acct:fail:${await sha256Hex(email)}`;

export async function getUser(kv: KVNamespace, id: string): Promise<UserRecord | null> {
  if (!/^u_[A-Za-z0-9_-]{10,40}$/.test(id)) return null;
  const raw = await kv.get(userKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserRecord;
  } catch {
    return null;
  }
}

/** Grandfathered accounts (no field) and confirmed ones are verified; only an explicit false is not. */
export function isVerified(user: UserRecord): boolean {
  return user.emailVerified !== false;
}

/** An unverified sign-up that was never confirmed within 7 days. */
export function isStaleUnverified(user: UserRecord, now: number): boolean {
  if (isVerified(user)) return false;
  const created = Date.parse(user.createdAt);
  return Number.isFinite(created) && now - created > UNVERIFIED_MAX_AGE_MS;
}

export async function putUser(kv: KVNamespace, user: UserRecord): Promise<void> {
  // Unverified records expire on their own (a safety net behind the lazy 7-day purge).
  const opts = isVerified(user) ? undefined : { expirationTtl: UNVERIFIED_TTL_S };
  await kv.put(userKey(user.id), JSON.stringify(user), opts);
}

/** Write the email → user id pointer (expiring with the user record while unverified). */
export async function putEmailPointer(kv: KVNamespace, user: UserRecord): Promise<void> {
  const opts = isVerified(user) ? undefined : { expirationTtl: UNVERIFIED_TTL_S };
  await kv.put(await emailKey(user.email), user.id, opts);
}

/** Mark the address confirmed and make the records permanent. */
export async function markVerified(kv: KVNamespace, user: UserRecord): Promise<void> {
  delete user.emailVerified;
  await putUser(kv, user);
  await putEmailPointer(kv, user);
}

export async function findUserIdByEmail(kv: KVNamespace, email: string): Promise<string | null> {
  return kv.get(await emailKey(email));
}

/**
 * The account for an email, purging it first if it is an unverified sign-up older than 7 days
 * (so an abandoned or squatted sign-up frees the address).
 */
export async function findUserByEmail(kv: KVNamespace, email: string, now: number): Promise<UserRecord | null> {
  const uid = await findUserIdByEmail(kv, email);
  const user = uid ? await getUser(kv, uid) : null;
  if (!user) return null;
  if (isStaleUnverified(user, now)) {
    await deleteUserRecords(kv, user, null);
    return null;
  }
  return user;
}

export async function createUser(
  kv: KVNamespace,
  input: { email: string; password?: string; name: string; provider?: { name: "google" | "apple"; sub: string }; unverified?: boolean },
  now: number,
): Promise<UserRecord | null> {
  const key = await emailKey(input.email);
  const existingId = await kv.get(key);
  // A pointer to a record that no longer exists (expired unverified sign-up) doesn't block the address.
  if (existingId && (await getUser(kv, existingId))) return null;
  const user: UserRecord = {
    id: `u_${randomToken(15)}`,
    email: input.email,
    name: input.name,
    createdAt: new Date(now).toISOString(),
    ...(input.password ? { password: await hashPassword(input.password) } : {}),
    passkeys: [],
    ...(input.provider ? { providers: { [input.provider.name]: input.provider.sub } } : {}),
    ...(input.unverified ? { emailVerified: false } : {}),
  };
  // KV has no transactions: write the user first, then claim the email. A lost race
  // (two sign-ups for one email within KV's propagation window) leaves an orphan user record
  // nobody can sign in to; acceptable at pilot scale.
  await putUser(kv, user);
  await putEmailPointer(kv, user);
  if (input.provider) await kv.put(providerKey(input.provider.name, input.provider.sub), user.id);
  return user;
}

export const providerKey = (provider: "google" | "apple", sub: string) => `acct:oidc:${provider}:${sub}`;

/** Delete the account and everything keyed by it (sessions other than `token` expire on their own and fail the user lookup). */
export async function deleteUserRecords(kv: KVNamespace, user: UserRecord, token: string | null): Promise<void> {
  for (const pk of user.passkeys) await kv.delete(credKey(pk.id));
  for (const [provider, sub] of Object.entries(user.providers ?? {})) if (sub) await kv.delete(providerKey(provider as "google" | "apple", sub));
  await kv.delete(await emailKey(user.email));
  await kv.delete(userKey(user.id));
  // Pending email codes (their link tokens expire within 30 minutes and then point nowhere).
  await kv.delete(`acct:chal:verify:${user.id}`);
  await kv.delete(`acct:chal:reset:${user.id}`);
  if (token) await kv.delete(await sessKey(token));
}

export function publicAccount(user: UserRecord): PublicAccount {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    hasPassword: Boolean(user.password),
    emailVerified: isVerified(user),
    providers: (Object.keys(user.providers ?? {}) as ("google" | "apple")[]).sort(),
    passkeys: user.passkeys.map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, ...(lastUsedAt ? { lastUsedAt } : {}) })),
  };
}

// ---- sessions ---------------------------------------------------------------------

export async function createSession(kv: KVNamespace, uid: string, remember: boolean, now: number): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken(32);
  const ttl = remember ? SESSION_REMEMBER_S : SESSION_SHORT_S;
  const record: SessionRecord = { uid, exp: now + ttl * 1000, remember, createdAt: now };
  await kv.put(await sessKey(token), JSON.stringify(record), { expirationTtl: ttl });
  return { token, expiresAt: record.exp };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  // Our tokens are 43 base64url chars; reject anything else before touching KV.
  return /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : null;
}

/** Resolve the bearer token to a live session + user, or null. */
export async function authenticate(request: Request, env: Env, now: number): Promise<{ token: string; session: SessionRecord; user: UserRecord } | null> {
  const kv = env.SENTIA_KV;
  if (!kv) return null;
  const token = bearerToken(request);
  if (!token) return null;
  const raw = await kv.get(await sessKey(token));
  if (!raw) return null;
  let session: SessionRecord;
  try {
    session = JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
  if (!session.uid || session.exp <= now) return null;
  const user = await getUser(kv, session.uid);
  if (!user) return null;
  // No access until the email is confirmed, and none for sessions revoked by a password reset.
  if (!isVerified(user)) return null;
  if (user.sessionsValidAfter && session.createdAt < user.sessionsValidAfter) return null;
  return { token, session, user };
}

export async function endSession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(await sessKey(token));
}

// ---- failed sign-in lockout ---------------------------------------------------------

/** Failed sign-ins for this email in the current window (MAX_FAILED_SIGNINS or more = locked). */
export async function failedSignIns(kv: KVNamespace, email: string): Promise<number> {
  return Number.parseInt((await kv.get(await failKey(email))) ?? "0", 10) || 0;
}

export async function recordFailedSignIn(kv: KVNamespace, email: string): Promise<void> {
  const key = await failKey(email);
  const count = Number.parseInt((await kv.get(key)) ?? "0", 10) || 0;
  await kv.put(key, String(count + 1), { expirationTtl: FAIL_WINDOW_S });
}

export async function clearFailedSignIns(kv: KVNamespace, email: string): Promise<void> {
  await kv.delete(await failKey(email));
}
