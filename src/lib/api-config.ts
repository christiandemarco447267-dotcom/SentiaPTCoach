// Where the Sentia API (the Cloudflare Worker in /worker) lives.
//
// The built-in address is https://api.sentiacoach.com. The app asks that host
// whether it is up, and only then turns on live quotes, the AI coach, in-app
// feedback and analytics. Until /health answers, those features stay on their
// offline fallbacks (demo prices, the built-in coach, a GitHub issue).
// NEXT_PUBLIC_SENTIA_API_URL overrides the address (a GitHub repo variable for
// the Pages build, or http://127.0.0.1:8787 for a local worker).

/** Public address of the Sentia API on sentiacoach.com. */
export const SENTIA_COACH_API_URL = "https://api.sentiacoach.com";

/** Websites on sentiacoach.com that may call the API (the worker allowlist mirrors these). */
export const SENTIA_COACH_SITE_ORIGINS = ["https://sentiacoach.com", "https://www.sentiacoach.com"] as const;

/** Normalise a configured base URL; returns "" when unset or unsafe. */
export function normalizeApiUrl(raw: string | undefined | null): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
    if (url.search || url.hash || url.username || url.password) return "";
    return value;
  } catch {
    return "";
  }
}

const explicitApiUrl = normalizeApiUrl(process.env.NEXT_PUBLIC_SENTIA_API_URL);

/** Address the app calls. An explicit env URL wins; otherwise the sentiacoach.com API. */
export const SENTIA_API_URL = explicitApiUrl || SENTIA_COACH_API_URL;

/** True when no env URL is set, so the app is linked to api.sentiacoach.com. */
export function usingSentiaCoachApi(): boolean {
  return explicitApiUrl === "";
}

// An explicit URL is "configured" immediately. The built-in host stays off until
// probeSentiaCoachApi sees { ok: true } from /health, so a host that doesn't
// resolve yet cannot pause paper trading or replace the GitHub feedback fallback.
let linked = explicitApiUrl !== "";
const linkListeners = new Set<() => void>();

export function apiConfigured(): boolean {
  return linked;
}

export function subscribeApiLink(listener: () => void): () => void {
  linkListeners.add(listener);
  return () => linkListeners.delete(listener);
}

export function apiUrl(path: string): string {
  return `${SENTIA_API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** /health is ready only when the worker answers 2xx with `{ ok: true }`. */
export function healthSaysReady(status: number, body: unknown): boolean {
  return status >= 200 && status < 300 && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
}

/**
 * Ask the built-in host if it is up. A failure leaves the app on its offline
 * fallbacks. An explicit NEXT_PUBLIC_SENTIA_API_URL skips the probe (that URL is
 * already treated as configured).
 */
export async function probeSentiaCoachApi(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (linked || !usingSentiaCoachApi()) return linked;
  try {
    const res = await fetchImpl(apiUrl("/health"), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!healthSaysReady(res.status, body)) return false;
    linked = true;
    for (const listener of linkListeners) listener();
    return true;
  } catch {
    return false;
  }
}

/** App version shown in feedback context. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
