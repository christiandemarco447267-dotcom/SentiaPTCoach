import { beforeEach, describe, expect, it } from "vitest";
import { handle, scheduled } from "../src/index";
import {
  b64urlDecode,
  b64urlEncode,
  crossed,
  deriveKeys,
  encryptPayload,
  isPushEndpoint,
  recordKey,
  runAlertCron,
  vapidAuthorization,
  validateSubscribe,
  type PushRecord,
} from "../src/push";
import { cleanResults, clearSearchCache, parseQuery } from "../src/search";
import { clearQuoteCache } from "../src/quote";
import { ctx, FakeKV, jsonRes, makeEnv, mockFetch, PAGES } from "./helpers";

async function p256(): Promise<{ pub: Uint8Array; priv: CryptoKey; d: string; publicB64: string }> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  return { pub, priv: kp.privateKey, d: jwk.d as string, publicB64: b64urlEncode(pub) };
}

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const ALERT_ID = "11111111-2222-4333-8444-555555555555";

async function subscription() {
  const ua = await p256();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { ua, auth, sub: { endpoint: ENDPOINT, keys: { p256dh: ua.publicB64, auth: b64urlEncode(auth) } } };
}

describe("web push payload encryption (RFC 8291)", () => {
  it("round-trips: the browser side can decrypt what the Worker encrypts", async () => {
    const { ua, auth, sub } = await subscription();
    const body = await encryptPayload(JSON.stringify({ title: "Price alert", body: "AAPL rose above $200.00" }), sub);
    // Parse the aes128gcm header: salt(16) | rs(4) | idlen(1) | keyid(65) | ciphertext
    const salt = body.slice(0, 16);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    const asPublic = body.slice(21, 86);
    const ciphertext = body.slice(86);
    const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as SubtleCryptoDeriveKeyAlgorithm, ua.priv, 256));
    const { cek, nonce } = await deriveKeys(secret, new Uint8Array(auth), new Uint8Array(ua.pub), asPublic, salt);
    const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
    expect(plain[plain.length - 1]).toBe(2); // final-record delimiter
    expect(JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))).toEqual({ title: "Price alert", body: "AAPL rose above $200.00" });
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs an ES256 JWT for the push service origin that verifies with the public key", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
    const d = ((await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey).d as string;
    const header = await vapidAuthorization(ENDPOINT, { VAPID_PUBLIC_KEY: b64urlEncode(pub), VAPID_PRIVATE_KEY: d, VAPID_SUBJECT: "mailto:me@example.com" }, 1_700_000_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m as RegExpExecArray;
    expect(k).toBe(b64urlEncode(pub));
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c as string)));
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:me@example.com", exp: 1_700_000_000 + 12 * 3600 });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, b64urlDecode(sig as string), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe("push subscription validation", () => {
  it("accepts known push services only and keeps valid alerts", async () => {
    const { sub } = await subscription();
    const ok = validateSubscribe({ subscription: sub, alerts: [{ id: ALERT_ID, symbol: "aapl", direction: "above", price: 200.123 }, { id: "x", symbol: "AAPL", direction: "above", price: 1 }] });
    expect(ok.ok && ok.alerts).toEqual([{ id: ALERT_ID, symbol: "AAPL", direction: "above", price: 200.12 }]);
    expect(isPushEndpoint("https://evil.example.com/push")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(validateSubscribe({ subscription: { ...sub, endpoint: "https://169.254.169.254/" }, alerts: [] }).ok).toBe(false);
  });

  it("crossed() matches the app's alert rule", () => {
    expect(crossed({ direction: "above", price: 100 }, 100)).toBe(true);
    expect(crossed({ direction: "above", price: 100 }, 99.99)).toBe(false);
    expect(crossed({ direction: "below", price: 100 }, 99)).toBe(true);
    expect(crossed({ direction: "below", price: 100 }, 0)).toBe(false);
  });
});

describe("push routes + cron", () => {
  beforeEach(() => clearQuoteCache());

  it("is off (503) until VAPID keys are configured", async () => {
    const res = await handle(new Request("https://api.test/push/subscribe", { method: "POST", body: "{}", headers: { Origin: PAGES } }), makeEnv(), ctx);
    expect(res.status).toBe(503);
  });

  it("stores the subscription, then the cron pushes a crossed alert once and drops it", async () => {
    const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
    const vpub = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", vapid.publicKey)) as ArrayBuffer));
    const vd = ((await crypto.subtle.exportKey("jwk", vapid.privateKey)) as JsonWebKey).d as string;
    const kv = new FakeKV();
    const env = makeEnv({ VAPID_PUBLIC_KEY: vpub, VAPID_PRIVATE_KEY: vd, VAPID_SUBJECT: "mailto:me@example.com" }, kv);
    const { sub } = await subscription();
    const res = await handle(
      new Request("https://api.test/push/subscribe", {
        method: "POST",
        headers: { Origin: PAGES, "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub, alerts: [{ id: ALERT_ID, symbol: "AAPL", direction: "above", price: 200 }] }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const key = await recordKey(ENDPOINT);
    expect(((await kv.get(key, "json")) as PushRecord).alerts).toHaveLength(1);

    const sent: RequestInit[] = [];
    const { f } = mockFetch([["fcm.googleapis.com", (_u, init) => (sent.push(init ?? {}), new Response(null, { status: 201 }))]]);
    const out = await runAlertCron(env, async () => new Map([["AAPL", 201.5]]), f);
    expect(out).toMatchObject({ subscriptions: 1, sent: 1, removed: 1 });
    expect((sent[0]?.headers as Record<string, string>)["Content-Encoding"]).toBe("aes128gcm");
    expect((sent[0]?.headers as Record<string, string>).Authorization).toMatch(/^vapid t=/);
    expect(await kv.get(key)).toBeNull();
  });

  it("the scheduled handler is a no-op without configuration", async () => {
    const out = await scheduled(makeEnv(), mockFetch([]).f);
    expect(out).toEqual({ subscriptions: 0, checked: 0, sent: 0, removed: 0 });
  });
});

describe("ticker search", () => {
  beforeEach(() => {
    clearSearchCache();
    clearQuoteCache();
  });

  it("validates the query", () => {
    expect(parseQuery("apple")).toEqual({ q: "apple" });
    expect("error" in parseQuery("")).toBe(true);
    expect("error" in parseQuery("<script>")).toBe(true);
  });

  it("keeps clean US stock/ETF tickers", () => {
    const out = cleanResults({
      result: [
        { symbol: "AAPL", displaySymbol: "AAPL", description: "APPLE INC", type: "Common Stock" },
        { symbol: "AAPL.MX", displaySymbol: "AAPL.MX", description: "APPLE INC", type: "Common Stock" },
        { symbol: "APLE", displaySymbol: "APLE", description: "APPLE HOSPITALITY REIT", type: "REIT" },
        { symbol: "XYZ123456", displaySymbol: "XYZ123456", description: "bad", type: "Common Stock" },
        { symbol: "AAPL", displaySymbol: "AAPL", description: "dupe", type: "Common Stock" },
      ],
    });
    expect(out).toEqual([
      { symbol: "AAPL", name: "APPLE INC" },
      { symbol: "APLE", name: "APPLE HOSPITALITY REIT" },
    ]);
  });

  it("GET /search returns results, or 503 without a market-data key", async () => {
    const { f } = mockFetch([["finnhub.io/api/v1/search", () => jsonRes({ result: [{ symbol: "MSFT", displaySymbol: "MSFT", description: "MICROSOFT CORP", type: "Common Stock" }] })]]);
    const ok = await handle(new Request("https://api.test/search?q=micro", { headers: { Origin: PAGES } }), makeEnv({ FINNHUB_API_KEY: "k" }), ctx, f);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ results: [{ symbol: "MSFT", name: "MICROSOFT CORP" }] });
    const off = await handle(new Request("https://api.test/search?q=micro", { headers: { Origin: PAGES } }), makeEnv(), ctx, f);
    expect(off.status).toBe(503);
  });
});
