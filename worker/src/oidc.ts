// "Continue with Google" / "Continue with Apple": verify the provider's ID token (a JWT signed
// with RS256) against the provider's published keys (JWKS), then check issuer, audience,
// expiry and the one-time nonce this server issued.
//
// Google: Google Identity Services in the browser returns the ID token directly.
// Apple:  Sign in with Apple JS in popup mode (usePopup: true) returns authorization.id_token
//         (form_post can't work on a static site, so popup mode is required).

import type { Env } from "./env";
import { fromB64url, randomToken, sha256Hex } from "./auth";

export type OidcProvider = "google" | "apple";

export const PROVIDERS: Record<OidcProvider, { jwksUrl: string; issuers: string[] }> = {
  google: { jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", issuers: ["https://accounts.google.com", "accounts.google.com"] },
  apple: { jwksUrl: "https://appleid.apple.com/auth/keys", issuers: ["https://appleid.apple.com"] },
};

export const NONCE_TTL_S = 600;
const JWKS_CACHE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;

/** The client IDs (token audiences) this server accepts for each provider; empty = provider off. */
export function audiencesFor(provider: OidcProvider, env: Env): string[] {
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (provider === "google") return list(env.GOOGLE_CLIENT_ID);
  // Web uses the Services ID; a future native iOS sign-in presents the app's bundle id.
  return [...list(env.APPLE_SERVICES_ID), ...list(env.APPLE_BUNDLE_ID)];
}

export function providerEnabled(provider: OidcProvider, env: Env): boolean {
  return audiencesFor(provider, env).length > 0;
}

// ---- JWKS cache (per Worker instance) ---------------------------------------------

type Jwk = { kid?: string; kty?: string; alg?: string; n?: string; e?: string; use?: string };
const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();

export function clearJwksCache() {
  jwksCache.clear();
}

async function fetchJwks(url: string, f: typeof fetch, now: number, force = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (hit && !force && now - hit.at < JWKS_CACHE_MS) return hit.keys;
  const res = await f(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { at: now, keys });
  return keys;
}

// ---- JWT verification ---------------------------------------------------------------

export type IdTokenClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  name?: string;
};

function decodePart<T>(part: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(part))) as T;
  } catch {
    return null;
  }
}

/**
 * Verify an RS256 ID token. Returns the claims, or null for any problem (bad signature, wrong
 * issuer/audience, expired, nonce mismatch). Refetches the JWKS once if the key id is unknown
 * (providers rotate keys).
 */
export async function verifyIdToken(
  provider: OidcProvider,
  token: unknown,
  opts: { audiences: string[]; nonce: string; f: typeof fetch; now: number },
): Promise<IdTokenClaims | null> {
  if (typeof token !== "string" || token.length > 8000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decodePart<{ alg?: string; kid?: string }>(h);
  const claims = decodePart<IdTokenClaims>(p);
  if (!header || !claims || header.alg !== "RS256" || !header.kid) return null;

  const cfg = PROVIDERS[provider];
  let keys = await fetchJwks(cfg.jwksUrl, opts.f, opts.now);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await fetchJwks(cfg.jwksUrl, opts.f, opts.now, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return null;
  }
  if (!valid) return null;

  const nowS = Math.floor(opts.now / 1000);
  if (!cfg.issuers.includes(claims.iss)) return null;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.some((a) => opts.audiences.includes(a))) return null;
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS) return null;
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > nowS) return null;
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return null;
  // The nonce comes back as given (Google, Apple JS); accept its SHA-256 too (Apple native SDKs hash it).
  if (!claims.nonce || (claims.nonce !== opts.nonce && claims.nonce !== (await sha256Hex(opts.nonce)))) return null;
  return claims;
}

export function emailVerified(claims: IdTokenClaims): boolean {
  return claims.email_verified === true || claims.email_verified === "true";
}

// ---- one-time nonces -------------------------------------------------------------------

const nonceKey = (id: string) => `acct:nonce:${id}`;

export async function issueNonce(kv: KVNamespace): Promise<{ nonceId: string; nonce: string }> {
  const nonceId = randomToken(18);
  const nonce = randomToken(24);
  await kv.put(nonceKey(nonceId), nonce, { expirationTtl: NONCE_TTL_S });
  return { nonceId, nonce };
}

/** Read and delete a nonce (single use). */
export async function takeNonce(kv: KVNamespace, nonceId: unknown): Promise<string | null> {
  if (typeof nonceId !== "string" || !/^[A-Za-z0-9_-]{20,40}$/.test(nonceId)) return null;
  const key = nonceKey(nonceId);
  const nonce = await kv.get(key);
  if (!nonce) return null;
  await kv.delete(key);
  return nonce;
}
