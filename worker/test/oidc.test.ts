import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/index";
import { resetAccountLimiters } from "../src/accounts";
import { toB64url } from "../src/auth";
import { clearJwksCache, PROVIDERS, verifyIdToken } from "../src/oidc";
import { ctx, FakeKV, jsonRes, makeEnv, mockFetch, PAGES, RESEND_KEY, resendMock, signUpAndVerify } from "./helpers";

const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);
const NOW_S = Math.floor(NOW / 1000);
const GOOGLE_ID = "123-abc.apps.googleusercontent.com";
const APPLE_ID = "com.sentiacoach.web";

type Signer = { kid: string; jwk: JsonWebKey; sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string> };

async function makeSigner(kid: string): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk: JsonWebKey & { kid: string } = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid, alg: "RS256", use: "sig" };
  const enc = (o: unknown) => toB64url(new TextEncoder().encode(JSON.stringify(o)));
  return {
    kid,
    jwk,
    async sign(claims, header = {}) {
      const h = enc({ alg: "RS256", kid, typ: "JWT", ...header });
      const p = enc(claims);
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${toB64url(new Uint8Array(sig))}`;
    },
  };
}

let google: Signer;
let apple: Signer;
let rotated: Signer;
let googleKeys: JsonWebKey[];

function jwksFetch() {
  return mockFetch([
    [PROVIDERS.google.jwksUrl, () => jsonRes({ keys: googleKeys })],
    [PROVIDERS.apple.jwksUrl, () => jsonRes({ keys: [apple.jwk] })],
  ]);
}

async function call(env: ReturnType<typeof makeEnv>, f: typeof fetch, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: PAGES, "CF-Connecting-IP": "203.0.113.30" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handle(
    new Request(`https://api.test${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    ctx,
    f,
    NOW,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const googleClaims = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: GOOGLE_ID,
  sub: "google-sub-1",
  email: "Gina@Gmail.com",
  email_verified: true,
  name: "Gina G",
  iat: NOW_S - 10,
  exp: NOW_S + 3600,
  nonce,
  ...extra,
});

describe("Continue with Google / Apple", () => {
  let env: ReturnType<typeof makeEnv>;
  let kv: FakeKV;
  beforeEach(async () => {
    resetAccountLimiters();
    clearJwksCache();
    google ??= await makeSigner("g1");
    apple ??= await makeSigner("a1");
    rotated ??= await makeSigner("g2");
    googleKeys = [google.jwk];
    kv = new FakeKV();
    env = makeEnv({ GOOGLE_CLIENT_ID: GOOGLE_ID, APPLE_SERVICES_ID: APPLE_ID }, kv);
  });

  const nonce = async (f: typeof fetch) => (await call(env, f, "/auth/oauth/nonce", {})).body as { nonceId: string; nonce: string };

  it("reports which providers are configured", async () => {
    const { f } = jwksFetch();
    expect((await call(env, f, "/auth/providers")).body).toEqual({ google: true, apple: true });
    expect((await call(makeEnv({}, new FakeKV()), f, "/auth/providers")).body).toEqual({ google: false, apple: false });
  });

  it("creates an account from a Google ID token, then signs the same person back in", async () => {
    const { f, calls } = jwksFetch();
    const n1 = await nonce(f);
    const first = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n1.nonce)), nonceId: n1.nonceId, remember: true });
    expect(first.status).toBe(201);
    expect(first.body.account).toMatchObject({ email: "gina@gmail.com", name: "Gina G", hasPassword: false, providers: ["google"] });
    expect(first.body.remember).toBe(true);
    const me = await call(env, f, "/auth/me", undefined, first.body.token);
    expect(me.body.account.id).toBe(first.body.account.id);

    const n2 = await nonce(f);
    const again = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n2.nonce, { email: "changed@gmail.com" })), nonceId: n2.nonceId });
    expect(again.status).toBe(200);
    expect(again.body.account.id).toBe(first.body.account.id);
    // JWKS fetched once and cached.
    expect(calls.filter((c) => c.url === PROVIDERS.google.jwksUrl)).toHaveLength(1);
    // A password sign-in can't get into a Google-only account.
    expect((await call(env, f, "/auth/signin", { email: "gina@gmail.com", password: "anything at all" })).status).toBe(401);
  });

  it("rejects bad tokens: wrong audience, issuer, expiry, nonce, signature, algorithm", async () => {
    const { f } = jwksFetch();
    const attempt = async (claims: (n: string) => Record<string, unknown>, signer: Signer = google, header: Record<string, unknown> = {}) => {
      resetAccountLimiters();
      const n = await nonce(f);
      return (await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await signer.sign(claims(n.nonce), header), nonceId: n.nonceId })).status;
    };
    expect(await attempt((n) => googleClaims(n, { aud: "someone-else.apps.googleusercontent.com" }))).toBe(401);
    expect(await attempt((n) => googleClaims(n, { iss: "https://evil.example" }))).toBe(401);
    expect(await attempt((n) => googleClaims(n, { exp: NOW_S - 120 }))).toBe(401);
    expect(await attempt(() => googleClaims("not-the-nonce"))).toBe(401);
    expect(await attempt((n) => googleClaims(n), apple, { kid: "g1" })).toBe(401); // signed by the wrong key
    expect(await attempt((n) => googleClaims(n), google, { alg: "none" })).toBe(401);
    expect(Object.keys(Object.fromEntries(kv.store)).some((k) => k.startsWith("acct:user:"))).toBe(false);
  });

  it("uses each nonce once", async () => {
    const { f } = jwksFetch();
    const n = await nonce(f);
    const token = await google.sign(googleClaims(n.nonce));
    expect((await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: token, nonceId: n.nonceId })).status).toBe(201);
    expect((await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: token, nonceId: n.nonceId })).status).toBe(401);
  });

  it("refetches the JWKS once when Google rotates keys", async () => {
    const { f, calls } = jwksFetch();
    const n1 = await nonce(f);
    await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n1.nonce)), nonceId: n1.nonceId });
    googleKeys = [google.jwk, rotated.jwk];
    const n2 = await nonce(f);
    const res = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await rotated.sign(googleClaims(n2.nonce)), nonceId: n2.nonceId });
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.url === PROVIDERS.google.jwksUrl)).toHaveLength(2);
  });

  it("links to an existing email account only when the provider verified the email", async () => {
    const { f } = jwksFetch();
    const pw = await signUpAndVerify(env, { email: "gina@gmail.com", password: "a long passphrase" }, { now: NOW, next: f });
    expect(pw.status).toBe(200);
    // An unverified provider email is never used as the account email: a separate account with a private placeholder address.
    const n1 = await nonce(f);
    const unverified = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n1.nonce, { email_verified: false, sub: "other-google-sub" })), nonceId: n1.nonceId });
    expect(unverified.status).toBe(201);
    expect(unverified.body.account.id).not.toBe(pw.body.account.id);
    expect(unverified.body.account.email).toMatch(/@users\.sentia\.invalid$/);
    const n2 = await nonce(f);
    const linked = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n2.nonce)), nonceId: n2.nonceId });
    expect(linked.status).toBe(200);
    expect(linked.body.account.id).toBe(pw.body.account.id);
    expect(linked.body.account).toMatchObject({ hasPassword: true, providers: ["google"], emailVerified: true });
  });

  it("a verified Google sign-in takes over an unconfirmed email sign-up for the same address (drops its password)", async () => {
    const { f } = jwksFetch();
    const mail = resendMock(f);
    env.RESEND_API_KEY = RESEND_KEY;
    const squat = await call(env, mail.f, "/auth/signup", { email: "gina@gmail.com", password: "attacker passphrase" });
    expect(squat.status).toBe(201);
    expect(squat.body.token).toBeUndefined();
    const n = await nonce(f);
    const res = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n.nonce)), nonceId: n.nonceId });
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ email: "gina@gmail.com", hasPassword: false, emailVerified: true, providers: ["google"] });
    // The squatter's password no longer works.
    const signin = await call(env, f, "/auth/signin", { email: "gina@gmail.com", password: "attacker passphrase" });
    expect(signin.status).toBe(401);
    // And the old emailed code can't be used.
    const code = await call(env, f, "/auth/verify", { email: "gina@gmail.com", code: mail.codeOf() });
    expect(code.status).toBe(400);
  });

  it("new Google accounts with a verified email are verified right away (no code)", async () => {
    const { f } = jwksFetch();
    const n = await nonce(f);
    const res = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n.nonce)), nonceId: n.nonceId });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.account.emailVerified).toBe(true);
  });

  it("Apple: private-relay email, name from the first sign-in, string email_verified, hashed nonce accepted", async () => {
    const { f } = jwksFetch();
    const n = await nonce(f);
    const claims = {
      iss: "https://appleid.apple.com",
      aud: APPLE_ID,
      sub: "001234.apple.sub",
      email: "x7y8z9@privaterelay.appleid.com",
      email_verified: "true",
      is_private_email: "true",
      iat: NOW_S,
      exp: NOW_S + 600,
      nonce: n.nonce,
    };
    const res = await call(env, f, "/auth/oauth/verify", { provider: "apple", idToken: await apple.sign(claims), nonceId: n.nonceId, name: "Ada Lovelace" });
    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ email: "x7y8z9@privaterelay.appleid.com", name: "Ada Lovelace", providers: ["apple"] });

    // The ID token check also accepts sha256(nonce), as Apple's native SDKs send it.
    const n2 = await nonce(f);
    const hashed = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(n2.nonce))), (b) => b.toString(16).padStart(2, "0")).join("");
    const ok = await verifyIdToken("apple", await apple.sign({ ...claims, nonce: hashed }), { audiences: [APPLE_ID], nonce: n2.nonce, f, now: NOW });
    expect(ok?.sub).toBe("001234.apple.sub");
  });

  it("refuses a provider that isn't configured", async () => {
    const { f } = jwksFetch();
    const off = makeEnv({ GOOGLE_CLIENT_ID: GOOGLE_ID }, new FakeKV());
    const n = (await call(off, f, "/auth/oauth/nonce", {})).body;
    expect((await call(off, f, "/auth/oauth/verify", { provider: "apple", idToken: "a.b.c", nonceId: n.nonceId })).status).toBe(400);
  });

  it("deletes a Google-only account with a recent sign-in (no password to ask for)", async () => {
    const { f } = jwksFetch();
    const n = await nonce(f);
    const res = await call(env, f, "/auth/oauth/verify", { provider: "google", idToken: await google.sign(googleClaims(n.nonce)), nonceId: n.nonceId });
    expect((await call(env, f, "/auth/delete", {}, res.body.token)).status).toBe(200);
    expect([...kv.store.keys()].filter((k) => /^acct:(user|email|oidc|sess|state):/.test(k))).toEqual([]);
  });
});
