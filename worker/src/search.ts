// /search?q= — ticker lookup for the app's autocomplete, via Finnhub's symbol search.
// Needs FINNHUB_API_KEY (503 otherwise, and the app quietly stays on its local list).
// Results are US-listed stocks/ETFs only, cached in memory for 10 minutes per query.
import type { Env } from "./env";
import { finnhubAllowed } from "./quote";

export type SearchResult = { symbol: string; name: string };

// Share classes like BRK.B keep a one-letter suffix; foreign listings (AAPL.MX, SHOP.TO) are dropped.
const SYMBOL_RE = /^[A-Z][A-Z0-9]{0,5}([.-][A-Z])?$/;
const QUERY_RE = /^[A-Za-z0-9 .&'-]{1,30}$/;
const TYPES = new Set(["common stock", "etp", "etf", "adr", "reit"]);
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { results: SearchResult[]; expires: number }>();

export function parseQuery(raw: string | null): { q: string } | { error: string } {
  const q = (raw ?? "").trim();
  if (q.length < 1) return { error: "Pass ?q=apple" };
  if (!QUERY_RE.test(q)) return { error: "Search with letters, numbers and spaces (max 30)." };
  return { q };
}

/** Keep clean US tickers with a name; at most 10. */
export function cleanResults(body: unknown): SearchResult[] {
  if (!body || typeof body !== "object") return [];
  const result = (body as { result?: unknown }).result;
  if (!Array.isArray(result)) return [];
  const out: SearchResult[] = [];
  for (const r of result) {
    if (!r || typeof r !== "object") continue;
    const row = r as { symbol?: unknown; displaySymbol?: unknown; description?: unknown; type?: unknown };
    const symbol = String(row.displaySymbol ?? row.symbol ?? "").toUpperCase();
    const type = String(row.type ?? "").toLowerCase();
    if (!SYMBOL_RE.test(symbol) || (type && !TYPES.has(type))) continue;
    if (out.some((o) => o.symbol === symbol)) continue;
    const name = String(row.description ?? "").trim().slice(0, 80) || symbol;
    out.push({ symbol, name });
    if (out.length >= 10) break;
  }
  return out;
}

export function clearSearchCache() {
  cache.clear();
}

export async function searchSymbols(q: string, env: Env, f: typeof fetch = fetch, now: number = Date.now()): Promise<SearchResult[] | null> {
  if (!env.FINNHUB_API_KEY) return null;
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.results;
  if (!finnhubAllowed(now)) return [];
  const res = await f(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&exchange=US`, {
    headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return [];
  const results = cleanResults(await res.json());
  if (cache.size > 1000) cache.clear();
  cache.set(key, { results, expires: now + TTL_MS });
  return results;
}
