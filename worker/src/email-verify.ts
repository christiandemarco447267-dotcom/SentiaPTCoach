// One-time email challenges for "verify your email" and "reset your password".
//
// Each challenge has two ways in: a 6-digit code (typed in the app) and a long random link token
// (the button in the email). Both are single-use, expire after 30 minutes, and only their salted
// SHA-256 hashes are stored. A code allows 5 wrong tries, then a new email must be requested.
//
// Storage (all in SENTIA_KV):
//   acct:chal:<purpose>:<uid>        → Challenge JSON (30-minute TTL)
//   acct:ctok:<purpose>:<sha(token)> → uid            (30-minute TTL; finds the challenge from a link)
//   acct:mailrl:<purpose>:<sha(email)> → MailLimit JSON (send throttle, keyed by email so unknown
//                                        and known addresses behave the same)

import { bytesEqual, randomToken, sha256Hex, toB64url } from "./auth";
import { isAllowedOrigin, NATIVE_APP_ORIGINS } from "./http";
import { DEFAULT_SITE_URL } from "./mailer";
import type { Env } from "./env";

export type ChallengePurpose = "verify" | "reset";

export const CHALLENGE_TTL_S = 30 * 60;
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_INTERVAL_S = 60;
export const MAX_SENDS_PER_DAY = 5;
const DAY_MS = 24 * 3600 * 1000;

type Challenge = { salt: string; codeHash: string; tokenHash: string; exp: number; attempts: number };
type MailLimit = { last: number; windowStart: number; count: number };

const chalKey = (purpose: ChallengePurpose, uid: string) => `acct:chal:${purpose}:${uid}`;
const tokKey = async (purpose: ChallengePurpose, token: string) => `acct:ctok:${purpose}:${await sha256Hex(token)}`;
const limitKey = async (purpose: ChallengePurpose, email: string) => `acct:mailrl:${purpose}:${await sha256Hex(email)}`;

async function saltedHash(salt: string, value: string): Promise<string> {
  return sha256Hex(`${salt}:${value}`);
}

/** Uniform 6-digit code (rejection sampling, so every code is equally likely). */
export function randomCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const n = buf[0] as number;
    if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, "0");
  }
}

/** Only digits, exactly six (spaces and dashes from a paste are ignored). */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

export function validLinkToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(raw);
}

/** Create (or replace) the challenge for this account. Any earlier code or link stops working. */
export async function issueChallenge(kv: KVNamespace, purpose: ChallengePurpose, uid: string, now: number): Promise<{ code: string; token: string }> {
  const previous = await readChallenge(kv, purpose, uid);
  if (previous) await kv.delete(`acct:ctok:${purpose}:${previous.tokenHash}`);
  const code = randomCode();
  const token = randomToken(32);
  const salt = toB64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge: Challenge = { salt, codeHash: await saltedHash(salt, code), tokenHash: await sha256Hex(token), exp: now + CHALLENGE_TTL_S * 1000, attempts: 0 };
  await kv.put(chalKey(purpose, uid), JSON.stringify(challenge), { expirationTtl: CHALLENGE_TTL_S });
  await kv.put(await tokKey(purpose, token), uid, { expirationTtl: CHALLENGE_TTL_S });
  return { code, token };
}

async function readChallenge(kv: KVNamespace, purpose: ChallengePurpose, uid: string): Promise<Challenge | null> {
  const raw = await kv.get(chalKey(purpose, uid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Challenge;
  } catch {
    return null;
  }
}

export async function hasLiveChallenge(kv: KVNamespace, purpose: ChallengePurpose, uid: string, now: number): Promise<boolean> {
  const c = await readChallenge(kv, purpose, uid);
  return Boolean(c && c.exp > now && c.attempts < MAX_CODE_ATTEMPTS);
}

export async function clearChallenge(kv: KVNamespace, purpose: ChallengePurpose, uid: string): Promise<void> {
  const c = await readChallenge(kv, purpose, uid);
  if (c) await kv.delete(`acct:ctok:${purpose}:${c.tokenHash}`);
  await kv.delete(chalKey(purpose, uid));
}

export type CodeCheck = { ok: true } | { ok: false; reason: "invalid"; triesLeft: number } | { ok: false; reason: "expired" | "locked" };

/** Check a typed code. A wrong code uses up one of 5 tries; the 5th wrong try kills the challenge. Success consumes it. */
export async function checkCode(kv: KVNamespace, purpose: ChallengePurpose, uid: string, code: string, now: number): Promise<CodeCheck> {
  const c = await readChallenge(kv, purpose, uid);
  if (!c || c.exp <= now) return { ok: false, reason: "expired" };
  if (c.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: "locked" };
  const given = fromHex(await saltedHash(c.salt, code));
  if (bytesEqual(given, fromHex(c.codeHash))) {
    await clearChallenge(kv, purpose, uid);
    return { ok: true };
  }
  c.attempts += 1;
  if (c.attempts >= MAX_CODE_ATTEMPTS) {
    await clearChallenge(kv, purpose, uid);
    return { ok: false, reason: "locked" };
  }
  const ttl = Math.max(60, Math.ceil((c.exp - now) / 1000));
  await kv.put(chalKey(purpose, uid), JSON.stringify(c), { expirationTtl: ttl });
  return { ok: false, reason: "invalid", triesLeft: MAX_CODE_ATTEMPTS - c.attempts };
}

/** Consume a link token. Returns the account id it belongs to, or null (unknown, used or expired). */
export async function consumeLinkToken(kv: KVNamespace, purpose: ChallengePurpose, token: string, now: number): Promise<string | null> {
  if (!validLinkToken(token)) return null;
  const key = await tokKey(purpose, token);
  const uid = await kv.get(key);
  if (!uid) return null;
  const c = await readChallenge(kv, purpose, uid);
  if (!c || c.exp <= now || c.attempts >= MAX_CODE_ATTEMPTS || c.tokenHash !== (await sha256Hex(token))) {
    await kv.delete(key);
    return null;
  }
  await clearChallenge(kv, purpose, uid);
  return uid;
}

/** Peek at a link token without using it up (the reset page checks the link before asking for a password). */
export async function peekLinkToken(kv: KVNamespace, purpose: ChallengePurpose, token: string, now: number): Promise<string | null> {
  if (!validLinkToken(token)) return null;
  const uid = await kv.get(await tokKey(purpose, token));
  if (!uid) return null;
  const c = await readChallenge(kv, purpose, uid);
  if (!c || c.exp <= now || c.attempts >= MAX_CODE_ATTEMPTS || c.tokenHash !== (await sha256Hex(token))) return null;
  return uid;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---- send throttle ------------------------------------------------------------------------

export type SendLimit = { ok: true } | { ok: false; retryAfter: number; daily: boolean };

/** May we send another email of this kind to this address now? (1 per 60 s, 5 per rolling 24 h.) Records the send when ok. */
export async function takeSendSlot(kv: KVNamespace, purpose: ChallengePurpose, email: string, now: number): Promise<SendLimit> {
  const key = await limitKey(purpose, email);
  let rec: MailLimit | null = null;
  try {
    const raw = await kv.get(key);
    rec = raw ? (JSON.parse(raw) as MailLimit) : null;
  } catch {
    rec = null;
  }
  if (!rec || now - rec.windowStart >= DAY_MS) rec = { last: 0, windowStart: now, count: 0 };
  const sinceLast = now - rec.last;
  if (rec.last && sinceLast < RESEND_INTERVAL_S * 1000) return { ok: false, retryAfter: Math.ceil((RESEND_INTERVAL_S * 1000 - sinceLast) / 1000), daily: false };
  if (rec.count >= MAX_SENDS_PER_DAY) return { ok: false, retryAfter: Math.ceil((rec.windowStart + DAY_MS - now) / 1000), daily: true };
  rec.last = now;
  rec.count += 1;
  const ttl = Math.max(60, Math.ceil((rec.windowStart + DAY_MS - now) / 1000));
  await kv.put(key, JSON.stringify(rec), { expirationTtl: ttl });
  return { ok: true };
}

// ---- links ---------------------------------------------------------------------------------

/**
 * Where the email's button should point. The web app sends its own address (origin + base path,
 * e.g. https://…github.io/SentiaPTCoach); it is used only if that origin is one this API already
 * trusts (ALLOWED_ORIGINS / localhost for testing). Native apps and anything else get SITE_URL.
 */
export function resolveLinkBase(raw: unknown, env: Env): string {
  const fallback = ((env.SITE_URL ?? "").trim() || DEFAULT_SITE_URL).replace(/\/+$/, "");
  if (typeof raw !== "string" || raw.length > 200) return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  if (url.search || url.hash || url.username || url.password) return fallback;
  if (NATIVE_APP_ORIGINS.includes(url.origin) || !isAllowedOrigin(url.origin, env)) return fallback;
  const path = url.pathname.replace(/\/+$/, "");
  if (path && !/^(\/[A-Za-z0-9._-]{1,40}){1,3}$/.test(path)) return fallback;
  return `${url.origin}${path}`;
}

export function challengeLink(base: string, purpose: ChallengePurpose, token: string): string {
  const page = purpose === "verify" ? "verify" : "reset-password";
  return `${base}/${page}/?token=${encodeURIComponent(token)}`;
}

