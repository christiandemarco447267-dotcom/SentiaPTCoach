// Ticker search across the app's symbol universe (pure; unit-tested). The local
// directory covers the Markets universe, Time Machine / Legends tickers and the
// sector map's popular names. When the Sentia API has a /search endpoint, its
// results are merged in (see searchRemoteSymbols); otherwise search stays local.
import { apiConfigured, apiUrl } from "./api-config";
import { DEMO_UNIVERSE, KNOWN_NAMES } from "./market";
import { isValidSymbol, normalizeSymbol } from "./validation";

export type SymbolEntry = { symbol: string; name: string };

/** Popular tickers (names only; they don't change demo pricing or the Markets list). */
const POPULAR: Record<string, string> = {
  IVV: "iShares Core S&P 500 ETF",
  DIA: "SPDR Dow Jones Industrial Average ETF",
  IWM: "iShares Russell 2000 ETF",
  VEA: "Vanguard FTSE Developed Markets ETF",
  VWO: "Vanguard FTSE Emerging Markets ETF",
  AGG: "iShares Core US Aggregate Bond ETF",
  TLT: "iShares 20+ Year Treasury Bond ETF",
  XLK: "Technology Select Sector SPDR Fund",
  XLF: "Financial Select Sector SPDR Fund",
  XLE: "Energy Select Sector SPDR Fund",
  XLV: "Health Care Select Sector SPDR Fund",
  VGT: "Vanguard Information Technology ETF",
  VNQ: "Vanguard Real Estate ETF",
  SMH: "VanEck Semiconductor ETF",
  ARKK: "ARK Innovation ETF",
  INTC: "Intel Corporation",
  AVGO: "Broadcom Inc.",
  ORCL: "Oracle Corporation",
  CRM: "Salesforce, Inc.",
  ADBE: "Adobe Inc.",
  CSCO: "Cisco Systems, Inc.",
  IBM: "International Business Machines Corporation",
  QCOM: "Qualcomm Incorporated",
  TXN: "Texas Instruments Incorporated",
  MU: "Micron Technology, Inc.",
  PLTR: "Palantir Technologies Inc.",
  SHOP: "Shopify Inc.",
  SNOW: "Snowflake Inc.",
  NOW: "ServiceNow, Inc.",
  TSM: "Taiwan Semiconductor Manufacturing Company",
  DIS: "The Walt Disney Company",
  T: "AT&T Inc.",
  VZ: "Verizon Communications Inc.",
  CMCSA: "Comcast Corporation",
  NYT: "The New York Times Company",
  CHTR: "Charter Communications, Inc.",
  HD: "The Home Depot, Inc.",
  NKE: "NIKE, Inc.",
  MCD: "McDonald's Corporation",
  SBUX: "Starbucks Corporation",
  AMC: "AMC Entertainment Holdings, Inc.",
  F: "Ford Motor Company",
  GM: "General Motors Company",
  LOW: "Lowe's Companies, Inc.",
  PEP: "PepsiCo, Inc.",
  PG: "The Procter & Gamble Company",
  WMT: "Walmart Inc.",
  COST: "Costco Wholesale Corporation",
  KR: "The Kroger Co.",
  CL: "Colgate-Palmolive Company",
  WFC: "Wells Fargo & Company",
  C: "Citigroup Inc.",
  GS: "The Goldman Sachs Group, Inc.",
  MS: "Morgan Stanley",
  V: "Visa Inc.",
  MA: "Mastercard Incorporated",
  PYPL: "PayPal Holdings, Inc.",
  COF: "Capital One Financial Corporation",
  SCHW: "The Charles Schwab Corporation",
  JNJ: "Johnson & Johnson",
  UNH: "UnitedHealth Group Incorporated",
  PFE: "Pfizer Inc.",
  LLY: "Eli Lilly and Company",
  MRK: "Merck & Co., Inc.",
  ABBV: "AbbVie Inc.",
  TMO: "Thermo Fisher Scientific Inc.",
  COP: "ConocoPhillips",
  SLB: "Schlumberger Limited",
  BA: "The Boeing Company",
  CAT: "Caterpillar Inc.",
  GE: "GE Aerospace",
  DAL: "Delta Air Lines, Inc.",
  UPS: "United Parcel Service, Inc.",
  HON: "Honeywell International Inc.",
  LMT: "Lockheed Martin Corporation",
  UNP: "Union Pacific Corporation",
  LIN: "Linde plc",
  NUE: "Nucor Corporation",
  NEE: "NextEra Energy, Inc.",
  DUK: "Duke Energy Corporation",
  SO: "The Southern Company",
  O: "Realty Income Corporation",
  PLD: "Prologis, Inc.",
  AMT: "American Tower Corporation",
  UBER: "Uber Technologies, Inc.",
  ABNB: "Airbnb, Inc.",
  COIN: "Coinbase Global, Inc.",
  SPOT: "Spotify Technology S.A.",
  SQ: "Block, Inc.",
};

function buildDirectory(): SymbolEntry[] {
  const map = new Map<string, string>();
  for (const e of DEMO_UNIVERSE) map.set(e.symbol, e.name);
  for (const [s, n] of Object.entries(KNOWN_NAMES)) if (!map.has(s)) map.set(s, n);
  for (const [s, n] of Object.entries(POPULAR)) if (!map.has(s)) map.set(s, n);
  return [...map].map(([symbol, name]) => ({ symbol, name }));
}

export const SYMBOL_DIRECTORY: SymbolEntry[] = buildDirectory();

function scoreEntry(e: SymbolEntry, q: string): number {
  const sym = e.symbol.toUpperCase();
  const name = e.name.toUpperCase();
  if (sym === q) return 100;
  if (sym.startsWith(q)) return 80 - Math.min(20, sym.length - q.length);
  if (name.startsWith(q)) return 60;
  if (name.split(/[\s.,&'-]+/).some((w) => w.startsWith(q))) return 50;
  if (q.length >= 3 && name.includes(q)) return 30;
  return 0;
}

/**
 * Rank matches for a query: exact ticker, ticker prefix, company-name prefix,
 * name word prefix, then name contains. `extra` (held/watched symbols, remote
 * results) is merged in, deduplicated by ticker.
 */
export function searchSymbols(query: string, limit = 8, extra: SymbolEntry[] = []): SymbolEntry[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const seen = new Map<string, SymbolEntry>();
  for (const e of [...SYMBOL_DIRECTORY, ...extra]) {
    const sym = normalizeSymbol(e.symbol);
    if (!isValidSymbol(sym) || seen.has(sym)) continue;
    seen.set(sym, { symbol: sym, name: e.name || sym });
  }
  return [...seen.values()]
    .map((e) => ({ e, s: scoreEntry(e, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.symbol.length - b.e.symbol.length || a.e.symbol.localeCompare(b.e.symbol))
    .slice(0, limit)
    .map((x) => x.e);
}

/** Parse the API's /search response; anything malformed is dropped. */
export function parseSearchResponse(body: unknown): SymbolEntry[] {
  if (!body || typeof body !== "object") return [];
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: SymbolEntry[] = [];
  for (const r of results.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const sym = typeof (r as { symbol?: unknown }).symbol === "string" ? normalizeSymbol((r as { symbol: string }).symbol) : "";
    const name = typeof (r as { name?: unknown }).name === "string" ? (r as { name: string }).name.slice(0, 80) : sym;
    if (isValidSymbol(sym)) out.push({ symbol: sym, name: name || sym });
  }
  return out;
}

let remoteUnavailable = false;
let remoteSupport: Promise<boolean> | null = null;

/**
 * Does the API's /health say ticker search is on? Older Workers don't list
 * `search` at all, so anything but an explicit `search: true` means "stay local".
 */
export function healthAllowsSearch(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as { search?: unknown }).search === true;
}

/** Ask /health once per page load; avoids a 404 in the console on Workers without /search. */
function remoteSearchSupported(): Promise<boolean> {
  if (!remoteSupport) {
    remoteSupport = fetch(apiUrl("/health"), { cache: "no-store", signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.json() : null))
      .then(healthAllowsSearch)
      .catch(() => {
        remoteSupport = null; // network blip: try again on the next search
        return false;
      });
  }
  return remoteSupport;
}

/** Tests only: forget what this page load learned about /search. */
export function resetRemoteSearchState() {
  remoteUnavailable = false;
  remoteSupport = null;
}

/** Ask the Sentia API's /search (when configured). Never throws: returns [] on any problem. */
export async function searchRemoteSymbols(query: string, signal?: AbortSignal): Promise<SymbolEntry[]> {
  const q = query.trim();
  if (!apiConfigured() || remoteUnavailable || q.length < 2 || q.length > 30) return [];
  try {
    if (!(await remoteSearchSupported())) return [];
    if (signal?.aborted) return [];
    const res = await fetch(apiUrl(`/search?q=${encodeURIComponent(q)}`), { cache: "no-store", signal: signal ?? AbortSignal.timeout(5000) });
    if (res.status === 404 || res.status === 503) {
      remoteUnavailable = true; // search went away or lost its market-data key: stay local this session
      return [];
    }
    if (!res.ok) return [];
    return parseSearchResponse(await res.json());
  } catch {
    return [];
  }
}
