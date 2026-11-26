// Passkeys (WebAuthn): "Sign in with Face ID / Touch ID" and fingerprint / Windows Hello.
// Uses @simplewebauthn/server (WebCrypto only, runs on Workers). Challenges are single-use,
// stored in KV for 5 minutes and deleted as soon as they are checked.
//
// The relying-party ID (the domain a passkey is bound to) comes from the request's Origin,
// which has already passed the CORS allowlist:
//   https://<user>.github.io            → <user>.github.io
//   https://sentiacoach.com / www.       → sentiacoach.com   (one passkey works on both)
//   http://localhost:<port>              → localhost         (local testing)
// The native apps (capacitor://localhost, https://localhost) are refused: a WKWebView / Android
// WebView needs Associated Domains / Digital Asset Links set up first (see STORE_RELEASE.md).

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { credKey, fromB64url, getUser, putUser, randomToken, toB64url, type StoredPasskey, type UserRecord } from "./auth";
import { isAllowedOrigin, NATIVE_APP_ORIGINS } from "./http";
import type { Env } from "./env";

export const CHALLENGE_TTL_S = 300;
export const MAX_PASSKEYS = 10;
const RP_NAME = "Sentia";

export type RelyingParty = { rpID: string; origin: string };

/** Work out which domain passkeys belong to for this browser origin (null = passkeys not available here). */
export function relyingPartyFor(origin: string | null, env: Env): RelyingParty | null {
  if (!origin || !isAllowedOrigin(origin, env) || NATIVE_APP_ORIGINS.includes(origin)) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (url.protocol === "http:") return host === "localhost" ? { rpID: "localhost", origin } : null;
  if (url.protocol !== "https:") return null;
  if (host === "sentiacoach.com" || host === "www.sentiacoach.com") return { rpID: "sentiacoach.com", origin };
  return { rpID: host, origin };
}

type Challenge = { challenge: string; kind: "register" | "login"; uid?: string; rpID: string; origin: string };

const chalKey = (id: string) => `acct:chal:${id}`;

async function saveChallenge(kv: KVNamespace, value: Challenge): Promise<string> {
  const id = randomToken(18);
  await kv.put(chalKey(id), JSON.stringify(value), { expirationTtl: CHALLENGE_TTL_S });
  return id;
}

/** Read and immediately delete a challenge (single use). */
async function takeChallenge(kv: KVNamespace, id: unknown): Promise<Challenge | null> {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{20,40}$/.test(id)) return null;
  const raw = await kv.get(chalKey(id));
  if (!raw) return null;
  await kv.delete(chalKey(id));
  try {
    return JSON.parse(raw) as Challenge;
  } catch {
    return null;
  }
}

function cleanPasskeyName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40) : "";
  return name || "Passkey";
}

export async function registrationOptions(kv: KVNamespace, user: UserRecord, rp: RelyingParty) {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new TextEncoder().encode(user.id) as Uint8Array<ArrayBuffer>,
    attestationType: "none",
    excludeCredentials: user.passkeys.map((pk) => ({ id: pk.id, transports: pk.transports as AuthenticatorTransport[] | undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
    timeout: CHALLENGE_TTL_S * 1000,
  });
  const challengeId = await saveChallenge(kv, { challenge: options.challenge, kind: "register", uid: user.id, rpID: rp.rpID, origin: rp.origin });
  return { challengeId, options };
}

export async function verifyRegistration(
  kv: KVNamespace,
  user: UserRecord,
  rp: RelyingParty,
  body: { challengeId?: unknown; response?: unknown; name?: unknown },
  now: number,
): Promise<{ ok: true; passkey: StoredPasskey } | { ok: false; error: string }> {
  const fail = { ok: false as const, error: "Couldn't turn on Face ID / Touch ID. Please try again." };
  const challenge = await takeChallenge(kv, body.challengeId);
  if (!challenge || challenge.kind !== "register" || challenge.uid !== user.id || challenge.rpID !== rp.rpID || challenge.origin !== rp.origin) return fail;
  if (user.passkeys.length >= MAX_PASSKEYS) return { ok: false, error: `You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.` };
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch {
    return fail;
  }
  if (!result.verified) return fail;
  const { credential } = result.registrationInfo;
  if (user.passkeys.some((pk) => pk.id === credential.id)) return { ok: false, error: "This device is already set up." };
  if (await kv.get(credKey(credential.id))) return fail;
  const passkey: StoredPasskey = {
    id: credential.id,
    publicKey: toB64url(credential.publicKey),
    counter: credential.counter,
    ...(credential.transports?.length ? { transports: credential.transports } : {}),
    name: cleanPasskeyName(body.name),
    createdAt: new Date(now).toISOString(),
  };
  user.passkeys.push(passkey);
  await putUser(kv, user);
  await kv.put(credKey(passkey.id), user.id);
  return { ok: true, passkey };
}

export async function authenticationOptions(kv: KVNamespace, rp: RelyingParty) {
  // Discoverable credentials: the device offers the passkeys it has for this site, so the
  // server never reveals which emails have accounts.
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required", timeout: CHALLENGE_TTL_S * 1000 });
  const challengeId = await saveChallenge(kv, { challenge: options.challenge, kind: "login", rpID: rp.rpID, origin: rp.origin });
  return { challengeId, options };
}

export async function verifyAuthentication(
  kv: KVNamespace,
  rp: RelyingParty,
  body: { challengeId?: unknown; response?: unknown },
  now: number,
): Promise<UserRecord | null> {
  const challenge = await takeChallenge(kv, body.challengeId);
  if (!challenge || challenge.kind !== "login" || challenge.rpID !== rp.rpID || challenge.origin !== rp.origin) return null;
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response.id !== "string" || !/^[A-Za-z0-9_-]{16,1400}$/.test(response.id)) return null;
  const uid = await kv.get(credKey(response.id));
  if (!uid) return null;
  const user = await getUser(kv, uid);
  const passkey = user?.passkeys.find((pk) => pk.id === response.id);
  if (!user || !passkey) return null;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.id,
        publicKey: fromB64url(passkey.publicKey) as Uint8Array<ArrayBuffer>,
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransport[] | undefined,
      },
      requireUserVerification: true,
    });
    if (!result.verified) return null;
    passkey.counter = result.authenticationInfo.newCounter;
    passkey.lastUsedAt = new Date(now).toISOString();
    await putUser(kv, user);
    return user;
  } catch {
    return null;
  }
}

export async function removePasskey(kv: KVNamespace, user: UserRecord, id: unknown): Promise<boolean> {
  if (typeof id !== "string") return false;
  const before = user.passkeys.length;
  user.passkeys = user.passkeys.filter((pk) => pk.id !== id);
  if (user.passkeys.length === before) return false;
  await putUser(kv, user);
  await kv.delete(credKey(id));
  return true;
}

