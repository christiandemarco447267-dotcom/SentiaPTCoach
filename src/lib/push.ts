// Optional background price alerts through Web Push (OFF unless configured).
// Needs BOTH: the Sentia API (worker/) deployed with VAPID keys + its cron trigger,
// and NEXT_PUBLIC_VAPID_PUBLIC_KEY set for the site build. See worker/README.md →
// "Background price alerts". Without them the app only notifies while it's open.
// Only active alerts (id, ticker, direction, price) are sent to the server.
import { apiConfigured, apiUrl } from "./api-config";
import type { PriceAlert } from "./types";

export const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();

export type PushAlert = Pick<PriceAlert, "id" | "symbol" | "direction" | "price">;

export function backgroundPushConfigured(): boolean {
  return (
    apiConfigured() &&
    /^[A-Za-z0-9_-]{80,100}$/.test(VAPID_PUBLIC_KEY) &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Base64url → bytes (for applicationServerKey). */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** The alerts worth sending: active ones only, at most 50. */
export function pushPayloadAlerts(alerts: PriceAlert[]): PushAlert[] {
  return alerts
    .filter((a) => a.status === "active")
    .slice(0, 50)
    .map((a) => ({ id: a.id, symbol: a.symbol, direction: a.direction, price: a.price }));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The offline service worker isn't running yet. Reload and try again.")), 5000)),
  ]);
  return reg;
}

async function post(path: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Background alerts server responded ${res.status}.`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      // keep default
    }
    throw new Error(msg);
  }
}

export async function pushSubscribed(): Promise<boolean> {
  if (!backgroundPushConfigured()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function enableBackgroundPush(alerts: PriceAlert[]): Promise<void> {
  if (!backgroundPushConfigured()) throw new Error("Background alerts aren't set up on this build.");
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) }));
  await post("/push/subscribe", { subscription: sub.toJSON(), alerts: pushPayloadAlerts(alerts) });
}

export async function syncPushAlerts(alerts: PriceAlert[]): Promise<void> {
  if (!backgroundPushConfigured()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await post("/push/subscribe", { subscription: sub.toJSON(), alerts: pushPayloadAlerts(alerts) });
}

export async function disableBackgroundPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
