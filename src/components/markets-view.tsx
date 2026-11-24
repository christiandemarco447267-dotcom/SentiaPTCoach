"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { DEMO_UNIVERSE, nameForSymbol, priceSourceOf } from "@/lib/market";
import { quoteMap } from "@/lib/portfolio";
import { useApp } from "@/lib/store";
import { isValidSymbol, normalizeSymbol } from "@/lib/validation";
import { formatAsOfET } from "@/lib/live-quotes";
import { SymbolSearch } from "./symbol-search";
import { DemoPricesBadge, Loading, Panel, PageHeader, PriceSkeleton, QuoteBadge, Sparkline, StarButton } from "./ui";

export function MarketsView() {
  const { ready, state, quotes, market, refreshMarket } = useApp();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const prices = useMemo(() => quoteMap(quotes), [quotes]);

  const symbols = useMemo(() => {
    const held = state ? state.holdings.map((h) => normalizeSymbol(h.symbol)) : [];
    const universe = DEMO_UNIVERSE.map((e) => e.symbol);
    return Array.from(new Set([...universe, ...held]));
  }, [state]);

  if (!ready || !state) return <Loading />;

  const session = market.session ?? (market.status === "open" ? "open" : "closed");
  const statusText =
    market.feed === "live"
      ? `Real price · play money · ${session === "open" ? "market open" : session === "pre" ? "pre-market" : session === "post" ? "after hours" : "market closed"}`
      : market.status === "error"
        ? "Market unavailable — showing last data"
        : market.status === "loading"
          ? "Loading prices…"
          : "Simulated prices · auto-updating every 15s";
  const simulated = priceSourceOf(market) === "demo" || priceSourceOf(market) === "mixed";
  const missing = market.missing ?? [];

  return (
    <div className="stack gap-lg animate-in">
      <PageHeader
        title="Markets"
        subtitle="Prices for the demo universe plus anything you hold. Star a ticker to add it to your Watchlist."
        action={
          <button className="btn btn-sm" onClick={refreshMarket}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <Panel className="stack gap-sm">
        <label htmlFor="markets-search" className="row gap-sm">
          <strong>Find a ticker</strong>
          <span className="small dim">Type a symbol or company, use ↑ ↓ and Enter to open it in Trade.</span>
        </label>
        <form
          className="row gap-sm"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const sym = normalizeSymbol(search);
            if (isValidSymbol(sym)) router.push(`/app/trade?symbol=${encodeURIComponent(sym)}`);
          }}
        >
          <SymbolSearch
            id="markets-search"
            value={search}
            onChange={setSearch}
            onPick={(entry) => router.push(`/app/trade?symbol=${encodeURIComponent(entry.symbol)}`)}
            placeholder="Search e.g. AAPL or Apple"
            ariaLabel="Search tickers"
            className="grow"
          />
          <button type="submit" className="btn btn-primary" disabled={!isValidSymbol(normalizeSymbol(search))}>
            Open
          </button>
        </form>
      </Panel>

      <Panel className="row between wrap gap-sm">
        <span className="row wrap gap-sm">
          <span className={`pill ${market.status === "error" ? "" : "pill-primary"}`}>{statusText}</span>
          <DemoPricesBadge />
        </span>
        {market.updatedAt ? <span className="small dim">Updated {formatAsOfET(market.updatedAt)}</span> : null}
        {simulated ? (
          <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
            {market.demoReason === "unreachable"
              ? "The live price service can't be reached right now, so these prices are simulated. Pending orders and price alerts are paused until real prices return."
              : "These prices are simulated for practice and are not real market data."}
          </p>
        ) : (
          <p className="small muted" style={{ flexBasis: "100%", margin: 0 }}>
            Real market prices, simulated trades. Each price shows its source: <strong>Real price</strong> (current) or{" "}
            <strong>Real price · delayed</strong> (may lag), times in New York
            (ET). US market holidays aren&apos;t detected by the clock fallback.
            {missing.length ? ` No price available for: ${missing.join(", ")}.` : ""}
          </p>
        )}
      </Panel>

      <Panel>
        <div className="list">
          {symbols.map((symbol) => {
            const quote = prices.get(symbol);
            const change = quote?.changePercent ?? 0;
            return (
              <div key={symbol} className="list-row">
                <span className="sym-badge">{symbol.slice(0, 4)}</span>
                <div className="grow stack" style={{ gap: 2 }}>
                  <strong>{symbol}</strong>
                  <span className="small muted">{nameForSymbol(symbol)}</span>
                </div>
                <Sparkline symbol={symbol} />
                <div className="stack" style={{ alignItems: "flex-end", gap: 2 }}>
                  <strong>{quote ? formatCurrency(quote.price) : market.status === "loading" ? <PriceSkeleton /> : "—"}</strong>
                  <span className={`small ${change >= 0 ? "gain" : "loss"}`}>{quote ? formatPercent(change, true) : market.status === "loading" ? <PriceSkeleton width="3em" /> : "no price"}</span>
                  {quote ? <QuoteBadge quote={quote} /> : null}
                </div>
                <div className="row gap-sm">
                  <StarButton symbol={symbol} />
                  <Link
                    href={`/app/trade?symbol=${encodeURIComponent(symbol)}`}
                    className="btn btn-sm"
                    aria-label={`Trade ${symbol}`}
                  >
                    Trade
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
