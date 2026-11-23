// Optional background price alerts via Web Push (RFC 8030), with VAPID (RFC 8292)
// and aes128gcm payload encryption (RFC 8291), using only WebCrypto.
//
// OFF until configured: needs SENTIA_KV, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT, plus a cron trigger in wrangler.toml. See README.md →
// "Background price alerts (optional)".
//
// What's stored (KV "push:<sha256(endpoint)>", expires after 60 days without an
// update): the browser's push subscription (endpoint + public keys) and the user's
// ACTIVE alerts only (id, ticker, above/below, price). No names, no portfolio.
import type { Env } from "./env";

export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushAlert = { id: string; symbol: string; direction: "above" | "below"; price: number };
export type PushRecord = { sub: PushSubscriptionJSON; alerts: PushAlert[]; updatedAt: string };

export const MAX_ALERTS = 50;
export const RECORD_TTL_SECONDS = 60 * 86_400;
const SYMBOL_RE = /^[A-Z][A-Z0-9]{0,5}([.-][A-Z]{1,2})?$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Push services we deliver to (prevents using the Worker to POST to arbitrary URLs). */
export const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function pushConfigured(env: Env): boolean {
  return Boolean(env.SENTIA_KV && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

// ---- base64url ------------------------------------------------------------------

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const enc = new TextEncoder();

// ---- validation -----------------------------------------------------------------

export function validateSubscribe(body: unknown): { ok: true; sub: PushSubscriptionJSON; alerts: PushAlert[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body." };
  const b = body as { subscription?: unknown; alerts?: unknown };
  const s = b.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const endpoint = typeof s?.endpoint === "string" ? s.endpoint : "";
  const p256dh = typeof s?.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const auth = typeof s?.keys?.auth === "string" ? s.keys.auth : "";
  if (!isPushEndpoint(endpoint)) return { ok: false, error: "Unsupported push endpoint." };
  if (!B64URL_RE.test(p256dh) || b64urlDecode(p256dh).length !== 65) return { ok: false, error: "Invalid subscription key." };
  if (!B64URL_RE.test(auth) || b64urlDecode(auth).length !== 16) return { ok: false, error: "Invalid subscription secret." };
  if (!Array.isArray(b.alerts)) return { ok: false, error: "Pass an alerts list (can be empty)." };
  const alerts: PushAlert[] = [];
  for (const a of b.alerts.slice(0, MAX_ALERTS)) {
    if (!a || typeof a !== "object") continue;
    const x = a as Record<string, unknown>;
    const symbol = typeof x.symbol === "string" ? x.symbol.trim().toUpperCase() : "";
    const price = Number(x.price);
    if (typeof x.id !== "string" || !UUID_RE.test(x.id)) continue;
    if (!SYMBOL_RE.test(symbol) || !(price > 0) || price > 1_000_000) continue;
    if (x.direction !== "above" && x.direction !== "below") continue;
    alerts.push({ id: x.id, symbol, direction: x.direction, price: Math.round(price * 100) / 100 });
  }
  return { ok: true, sub: { endpoint, keys: { p256dh, auth } }, alerts };
}

export function isPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
    return PUSH_HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

export async function recordKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return `push:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function crossed(alert: Pick<PushAlert, "direction" | "price">, price: number): boolean {
  if (!(price > 0)) return false;
  return alert.direction === "above" ? price >= alert.price - 1e-9 : price <= alert.price + 1e-9;
}

// ---- VAPID (RFC 8292) -----------------------------------------------------------

async function importVapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = b64urlDecode(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 key (base64url).");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: privateKey,
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    ext: false,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** "vapid t=<JWT>, k=<public key>" for the push service at `endpoint`. */
export async function vapidAuthorization(endpoint: string, env: Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT">, now: number = Date.now()): Promise<string> {
  const pub = env.VAPID_PUBLIC_KEY ?? "";
  const key = await importVapidKey(pub, env.VAPID_PRIVATE_KEY ?? "");
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT ?? "mailto:admin@example.com" })),
  );
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${pub}`;
}

// ---- aes128gcm payload encryption (RFC 8291 / RFC 8188) -------------------------

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/** Derive the content key and nonce (shared by encrypt and the test's decrypt). */
export async function deriveKeys(
  ecdhSecret: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
  uaPublic: Uint8Array<ArrayBuffer>,
  asPublic: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ cek: Uint8Array<ArrayBuffer>; nonce: Uint8Array<ArrayBuffer> }> {
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  return { cek, nonce };
}

/** Encrypt one push message for a subscription. Returns the full aes128gcm body. */
export async function encryptPayload(payload: string, sub: PushSubscriptionJSON, opts: { salt?: Uint8Array<ArrayBuffer> } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const { cek, nonce } = await deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = concat(enc.encode(payload), new Uint8Array([2])); // single, final record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** Deliver one notification. Returns the push service's HTTP status. */
export async function sendPush(sub: PushSubscriptionJSON, message: { title: string; body: string; tag: string; url: string }, env: Env, f: typeof fetch = fetch, now: number = Date.now()): Promise<number> {
  const body = await encryptPayload(JSON.stringify(message), sub);
  const res = await f(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, env, now),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "3600",
      Urgency: "high",
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  return res.status;
}

// ---- storage + cron -------------------------------------------------------------

export async function saveRecord(env: Env, sub: PushSubscriptionJSON, alerts: PushAlert[], now: number = Date.now()): Promise<void> {
  if (!env.SENTIA_KV) return;
  const key = await recordKey(sub.endpoint);
  if (alerts.length === 0) {
    await env.SENTIA_KV.delete(key);
    return;
  }
  const record: PushRecord = { sub, alerts, updatedAt: new Date(now).toISOString() };
  await env.SENTIA_KV.put(key, JSON.stringify(record), { expirationTtl: RECORD_TTL_SECONDS });
}

export async function deleteRecord(env: Env, endpoint: string): Promise<void> {
  if (!env.SENTIA_KV || !isPushEndpoint(endpoint)) return;
  await env.SENTIA_KV.delete(await recordKey(endpoint));
}

function fmt(price: number): string {
  return `$${price.toFixed(2)}`;
}

export type CronResult = { subscriptions: number; checked: number; sent: number; removed: number };

/**
 * Cron: check every stored alert against current quotes, push the ones that
 * crossed, and drop them (one-shot, like in the app). Gone subscriptions (404/410)
 * are deleted. `quote` returns symbol → price for the symbols it could price.
 */
export async function runAlertCron(
  env: Env,
  quote: (symbols: string[]) => Promise<Map<string, number>>,
  f: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<CronResult> {
  const result: CronResult = { subscriptions: 0, checked: 0, sent: 0, removed: 0 };
  if (!pushConfigured(env) || !env.SENTIA_KV) return result;
  const kv = env.SENTIA_KV;
  const records: { key: string; rec: PushRecord }[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: "push:", cursor, limit: 1000 });
    for (const k of page.keys) {
      const rec = (await kv.get(k.name, "json")) as PushRecord | null;
      if (rec?.sub && Array.isArray(rec.alerts)) records.push({ key: k.name, rec });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && records.length < 5000);
  result.subscriptions = records.length;

  const symbols = [...new Set(records.flatMap((r) => r.rec.alerts.map((a) => a.symbol)))].slice(0, 100);
  if (!symbols.length) return result;
  const prices = await quote(symbols);

  for (const { key, rec } of records) {
    const keep: PushAlert[] = [];
    let gone = false;
    for (const alert of rec.alerts) {
      const price = prices.get(alert.symbol);
      result.checked += 1;
      if (gone || price === undefined || !crossed(alert, price)) {
        keep.push(alert);
        continue;
      }
      try {
        const status = await sendPush(
          rec.sub,
          {
            title: "Price alert",
            body: `${alert.symbol} ${alert.direction === "above" ? "rose above" : "fell below"} ${fmt(alert.price)} (now ${fmt(price)}). Paper trading only.`,
            tag: `alert-${alert.id}`,
            url: `app/trade/?symbol=${encodeURIComponent(alert.symbol)}`,
          },
          env,
          f,
          now,
        );
        if (status === 404 || status === 410) gone = true;
        else if (status >= 200 && status < 300) result.sent += 1;
        else keep.push(alert); // try again next run
      } catch {
        keep.push(alert);
      }
    }
    if (gone || keep.length === 0) {
      await kv.delete(key);
      result.removed += 1;
    } else if (keep.length !== rec.alerts.length) {
      await kv.put(key, JSON.stringify({ ...rec, alerts: keep }), { expirationTtl: RECORD_TTL_SECONDS });
    }
  }
  return result;
}
