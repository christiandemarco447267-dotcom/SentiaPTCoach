// App pages for the sidebar and the "/" search palette (pure; unit-tested).
import { searchSymbols, type SymbolEntry } from "./symbols";
import { isValidSymbol, normalizeSymbol } from "./validation";

export type NavSection = "Overview" | "Process" | "Practice";
export type NavPage = { href: string; label: string; section: NavSection; keywords?: string; needsAccounts?: boolean };

export const NAV_PAGES: NavPage[] = [
  { href: "/app", label: "Home", section: "Overview", keywords: "dashboard overview" },
  { href: "/app/portfolio", label: "Portfolio", section: "Overview", keywords: "holdings positions benchmark spy" },
  { href: "/app/trade", label: "Trade", section: "Overview", keywords: "buy sell order limit stop" },
  { href: "/app/markets", label: "Markets", section: "Overview", keywords: "quotes movers search" },
  { href: "/app/watchlist", label: "Watchlist", section: "Overview", keywords: "alerts watch star" },
  { href: "/app/allocate", label: "Allocation", section: "Overview", keywords: "diversify sectors" },
  { href: "/app/thesis", label: "Theses", section: "Process", keywords: "thesis plan why" },
  { href: "/app/insights", label: "Insights", section: "Process", keywords: "discipline score bias radar" },
  { href: "/app/report-card", label: "Report card", section: "Process", keywords: "weekly grade" },
  { href: "/app/journal", label: "Journal", section: "Process", keywords: "review plans lessons" },
  { href: "/app/coach", label: "Ask Sentia", section: "Process", keywords: "coach ai help question" },
  { href: "/app/legends", label: "Legends", section: "Process", keywords: "buffett famous investors" },
  { href: "/app/time-machine", label: "Time Machine", section: "Practice", keywords: "replay history crash" },
  { href: "/app/challenges", label: "Challenges", section: "Practice", keywords: "badges goals streak" },
  { href: "/app/leagues", label: "Leagues", section: "Practice", keywords: "friends leaderboard", needsAccounts: true },
  { href: "/app/settings", label: "Settings", section: "Practice", keywords: "preferences theme notifications" },
];

export const NAV_SECTIONS: NavSection[] = ["Overview", "Process", "Practice"];

/** Pages to show: Leagues needs accounts (Firebase), so it's hidden in guest-only builds. */
export function visibleNav(accountsEnabled: boolean): NavPage[] {
  return NAV_PAGES.filter((p) => accountsEnabled || !p.needsAccounts);
}

export type PaletteItem =
  | { kind: "ticker"; id: string; label: string; detail: string; href: string }
  | { kind: "page"; id: string; label: string; detail: string; href: string };

/** Results for the search palette: matching tickers first (each opens Trade), then pages. */
export function paletteResults(query: string, accountsEnabled: boolean, extra: SymbolEntry[] = [], limit = 10): PaletteItem[] {
  const q = query.trim();
  const pages = visibleNav(accountsEnabled);
  if (!q) {
    return pages.slice(0, limit).map((p) => ({ kind: "page", id: `page:${p.href}`, label: p.label, detail: p.section, href: p.href }));
  }
  const lower = q.toLowerCase();
  const pageHits = pages
    .map((p) => {
      const label = p.label.toLowerCase();
      const score = label.startsWith(lower) ? 3 : label.includes(lower) ? 2 : (p.keywords ?? "").includes(lower) ? 1 : 0;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ p }) => ({ kind: "page" as const, id: `page:${p.href}`, label: p.label, detail: p.section, href: p.href }));
  const tickers: PaletteItem[] = searchSymbols(q, 6, extra).map((e) => ({
    kind: "ticker",
    id: `sym:${e.symbol}`,
    label: e.symbol,
    detail: e.name,
    href: `/app/trade?symbol=${encodeURIComponent(e.symbol)}`,
  }));
  const typed = normalizeSymbol(q);
  if (isValidSymbol(typed) && /^[A-Za-z.\-]{1,6}$/.test(q) && !tickers.some((t) => t.label === typed)) {
    tickers.push({ kind: "ticker", id: `sym:${typed}`, label: typed, detail: "Trade this ticker", href: `/app/trade?symbol=${encodeURIComponent(typed)}` });
  }
  // A strong page-name match ("port", "coach") goes first; otherwise tickers lead.
  const strongPage = pageHits.length && pages.some((p) => p.label.toLowerCase().startsWith(lower)) && lower.length >= 3;
  const merged = strongPage ? [...pageHits, ...tickers] : [...tickers, ...pageHits];
  return merged.slice(0, limit);
}
