import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/index";
import { resetAccountLimiters } from "../src/accounts";
import { toB64url } from "../src/auth";
import { relyingPartyFor } from "../src/passkeys";
import { ctx, FakeKV, makeEnv, PAGES, signUpAndVerify } from "./helpers";

const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);
const SITE = "https://sentiacoach.com";

// ---- a tiny software authenticator (ES256, "none" attestation) ---------------------------

function cbor(value: unknown): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else out.push((major << 5) | 25, n >> 8, n & 255);
  };
  const enc = (v: unknown) => {
    if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === "string") {
      const b = new TextEncoder().encode(v);
      head(3, b.length);
      return out.push(...b);
    }
    if (v instanceof Uint8Array) {
      head(2, v.length);
      return out.push(...v);
    }
    if (v instanceof Map) {
      head(5, v.size);
      for (const [k, val] of v) {
        enc(k);
        enc(val);
      }
      return;
    }
    throw new Error("unsupported");
  };
  enc(value);
  return new Uint8Array(out);
}

const sha256 = async (data: Uint8Array | string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** WebCrypto gives raw r||s; WebAuthn wants DER. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i += 1;
    let v = b.slice(i);
    if ((v[0] ?? 0) & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

async function softAuthenticator(rpID: string, origin: string) {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, b64(jwk.x!)], [-3, b64(jwk.y!)]]));
  const credId = crypto.getRandomValues(new Uint8Array(20));
  const id = toB64url(credId);
  const rpHash = await sha256(rpID);
  let counter = 0;
  return {
    id,
    async register(challenge: string) {
      const authData = concat(rpHash, new Uint8Array([0x45]), u32(0), new Uint8Array(16), new Uint8Array([0, credId.length]), credId, cose);
      const clientData = JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false });
      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: toB64url(new TextEncoder().encode(clientData)),
          attestationObject: toB64url(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
          transports: ["internal"],
        },
        authenticatorAttachment: "platform",
      };
    },
    async assert(challenge: string, signOrigin = origin) {
      counter += 1;
      const authData = concat(rpHash, new Uint8Array([0x05]), u32(counter));
      const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge, origin: signOrigin, crossOrigin: false }));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, concat(authData, await sha256(clientData))));
      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: toB64url(clientData), authenticatorData: toB64url(authData), signature: toB64url(derSignature(sig)) },
        authenticatorAttachment: "platform",
      };
    },
  };
}

// ---- request helpers -------------------------------------------------------------------------

async function call(env: ReturnType<typeof makeEnv>, path: string, init: { body?: unknown; token?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: init.origin ?? SITE, "CF-Connecting-IP": "203.0.113.20" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await handle(
    new Request(`https://api.test${path}`, { method: init.body === undefined ? "GET" : "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
    env,
    ctx,
    fetch,
    NOW,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("relying party", () => {
  const env = makeEnv({ ALLOWED_ORIGINS: `${PAGES},https://sentiacoach.com,https://www.sentiacoach.com` });
  it("derives the rpID from allowlisted origins", () => {
    expect(relyingPartyFor(PAGES, env)?.rpID).toBe("christiandemarco447267-dotcom.github.io");
    expect(relyingPartyFor("https://sentiacoach.com", env)?.rpID).toBe("sentiacoach.com");
    expect(relyingPartyFor("https://www.sentiacoach.com", env)?.rpID).toBe("sentiacoach.com");
    expect(relyingPartyFor("http://localhost:3000", env)?.rpID).toBe("localhost");
  });
  it("refuses native app origins (incl. bare http://localhost, Android's http scheme), unknown sites and missing origins", () => {
    for (const o of ["capacitor://localhost", "https://localhost", "http://localhost", "https://evil.example", null]) {
      expect(relyingPartyFor(o, env)).toBeNull();
    }
    expect(relyingPartyFor("http://127.0.0.1:3000", env)).toBeNull();
  });
});

describe("passkeys (Face ID / Touch ID)", () => {
  let env: ReturnType<typeof makeEnv>;
  let token: string;
  beforeEach(async () => {
    resetAccountLimiters();
    env = makeEnv({ ALLOWED_ORIGINS: "https://sentiacoach.com,https://www.sentiacoach.com" }, new FakeKV());
    token = (await signUpAndVerify(env, { email: "pk@example.com", password: "a long passphrase" }, { now: NOW, origin: SITE })).body.token;
  });

  it("registers a platform passkey and signs in with it (www works too)", async () => {
    const device = await softAuthenticator("sentiacoach.com", SITE);
    const opts = await call(env, "/auth/passkey/register/options", { token, body: {} });
    expect(opts.status).toBe(200);
    expect(opts.body.options.rp.id).toBe("sentiacoach.com");
    expect(opts.body.options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" });
    const reg = await call(env, "/auth/passkey/register/verify", {
      token,
      body: { challengeId: opts.body.challengeId, response: await device.register(opts.body.options.challenge), name: "iPhone" },
    });
    expect(reg.status).toBe(200);
    expect(reg.body.account.passkeys).toEqual([expect.objectContaining({ id: device.id, name: "iPhone" })]);

    // Challenges are single use.
    const replay = await call(env, "/auth/passkey/register/verify", {
      token,
      body: { challengeId: opts.body.challengeId, response: await device.register(opts.body.options.challenge) },
    });
    expect(replay.status).toBe(400);

    const login = await call(env, "/auth/passkey/login/options", { body: {} });
    expect(login.body.options.rpId).toBe("sentiacoach.com");
    expect(login.body.options.allowCredentials ?? []).toEqual([]); // discoverable: no account hints
    const signedIn = await call(env, "/auth/passkey/login/verify", {
      body: { challengeId: login.body.challengeId, response: await device.assert(login.body.options.challenge), remember: true },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.account.email).toBe("pk@example.com");
    expect(signedIn.body.remember).toBe(true);

    const www = "https://www.sentiacoach.com";
    const login2 = await call(env, "/auth/passkey/login/options", { body: {}, origin: www });
    const fromWww = await call(env, "/auth/passkey/login/verify", {
      origin: www,
      body: { challengeId: login2.body.challengeId, response: await device.assert(login2.body.options.challenge, www) },
    });
    expect(fromWww.status).toBe(200);
  });

  it("rejects a wrong challenge, a wrong origin, and an unknown credential", async () => {
    const device = await softAuthenticator("sentiacoach.com", SITE);
    const opts = await call(env, "/auth/passkey/register/options", { token, body: {} });
    await call(env, "/auth/passkey/register/verify", { token, body: { challengeId: opts.body.challengeId, response: await device.register(opts.body.options.challenge) } });

    const login = await call(env, "/auth/passkey/login/options", { body: {} });
    const wrongChallenge = await call(env, "/auth/passkey/login/verify", { body: { challengeId: login.body.challengeId, response: await device.assert("AAAAAAAAAAAAAAAAAAAAAA") } });
    expect(wrongChallenge.status).toBe(401);

    const login2 = await call(env, "/auth/passkey/login/options", { body: {} });
    const phished = await call(env, "/auth/passkey/login/verify", { body: { challengeId: login2.body.challengeId, response: await device.assert(login2.body.options.challenge, "https://evil.example") } });
    expect(phished.status).toBe(401);

    const stranger = await softAuthenticator("sentiacoach.com", SITE);
    const login3 = await call(env, "/auth/passkey/login/options", { body: {} });
    const unknown = await call(env, "/auth/passkey/login/verify", { body: { challengeId: login3.body.challengeId, response: await stranger.assert(login3.body.options.challenge) } });
    expect(unknown.status).toBe(401);
  });

  it("needs a session to register, refuses the native app origin, and can remove a passkey", async () => {
    expect((await call(env, "/auth/passkey/register/options", { body: {} })).status).toBe(401);
    expect((await call(env, "/auth/passkey/register/options", { token, body: {}, origin: "capacitor://localhost" })).status).toBe(400);
    const device = await softAuthenticator("sentiacoach.com", SITE);
    const opts = await call(env, "/auth/passkey/register/options", { token, body: {} });
    await call(env, "/auth/passkey/register/verify", { token, body: { challengeId: opts.body.challengeId, response: await device.register(opts.body.options.challenge) } });
    const removed = await call(env, "/auth/passkey/remove", { token, body: { id: device.id } });
    expect(removed.body.account.passkeys).toEqual([]);
    const login = await call(env, "/auth/passkey/login/options", { body: {} });
    expect((await call(env, "/auth/passkey/login/verify", { body: { challengeId: login.body.challengeId, response: await device.assert(login.body.options.challenge) } })).status).toBe(401);
  });
});
