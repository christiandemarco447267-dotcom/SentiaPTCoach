"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, ArrowUpRight, Briefcase, History, Lightbulb, LineChart, MessageCircle, PieChart, RefreshCw } from "lucide-react";
import { formatCurrency, formatPercent, formatShareCount, formatSignedCurrency } from "@/lib/format";
import { realizedPnl } from "@/lib/portfolio";
import { useApp } from "@/lib/store";
import { DisciplineCard } from "./discipline-card";
import { StarterBanner } from "./starter-banner";
import { ChartSkeleton, EmptyState, Loading, Panel, PriceSkeleton, RowsSkeleton } from "./ui";

// The chart code loads after the page is interactive; a same-height shimmer holds its place.
const BenchmarkCard = dynamic(() => import("./benchmark-chart").then((m) => m.BenchmarkCard), {
  ssr: false,
  loading: () => (
    <div className="panel stack gap-sm">
      <ChartSkeleton height={176} />
    </div>
  ),
});

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function marketLabel(status: string): string {
  switch (status) {
    case "loading":
      return "Loading market…";
    case "open":
      return "Real price · play money · market open";
    case "closed":
      return "Real price · play money · market closed";
    case "demo":
      return "Demo prices · auto-updating";
    case "error":
      return "Market unavailable";
    default:
      return status;
  }
}

export function DashboardHome() {
  const { ready, state, summary, market, refreshMarket, actions } = useApp();
  const [nameInput, setNameInput] = useState("");
  if (!ready || !state || !summary) return <Loading />;

  const realized = realizedPnl(state);
  const firstName = state.profileName.split(" ")[0];

  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    if (nameInput.trim()) actions.setProfileName(nameInput);
  };

  return (
    <div className="stack gap-lg animate-in">
      <div className="row between wrap gap-md">
        <div className="stack gap-sm">
          <span className="eyebrow">{greeting()}</span>
          <h1 style={{ fontSize: "2rem" }}>{firstName ? `Welcome back, ${firstName}` : "Your investing workspace"}</h1>
        </div>
        <div className="row wrap gap-sm">
          <span className={`pill ${market.status === "error" ? "" : "pill-primary"}`}>{marketLabel(market.status)}</span>
          <button className="btn btn-sm" onClick={refreshMarket}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {!firstName ? (
        <Panel className="row between wrap gap-md">
          <div className="stack" style={{ gap: 2 }}>
            <strong>Make it yours</strong>
            <span className="small muted">Add your name so Sentia can greet you.</span>
          </div>
          <form className="row gap-sm" onSubmit={saveName}>
            <input
              id="dashboard-name"
              name="name"
              className="input"
              style={{ maxWidth: 200 }}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              maxLength={40}
              aria-label="Your name"
            />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!nameInput.trim()}>
              Save
            </button>
          </form>
        </Panel>
      ) : null}

      <StarterBanner />

      <Panel strong className="panel-pad-lg hero-balance holo stack gap-md">
        <span className="eyebrow">Total portfolio value</span>
        <div className="row between wrap gap-md">
          <span className="value-xl">{market.status === "loading" && state.holdings.length ? <PriceSkeleton width="7em" /> : formatCurrency(summary.total)}</span>
          <span className={`badge ${summary.gain >= 0 ? "badge-gain" : "badge-loss"}`} title="Open-position P/L: current value vs. what you paid">
            {summary.gain >= 0 ? <ArrowUpRight size={16} /> : null}
            {formatSignedCurrency(summary.gain)} ({formatPercent(summary.gainPercent, true)}) open P/L
          </span>
        </div>
        <div className="row wrap gap-md">
          <span className="pill">Cash {formatCurrency(summary.cash)}</span>
          <span className="pill">Invested {formatCurrency(summary.investments)}</span>
          <span className="pill">Realized P/L {formatSignedCurrency(realized)}</span>
        </div>
        <Link href="/app/portfolio" className="btn btn-primary" style={{ width: "fit-content" }}>
          View portfolio <ArrowRight size={16} />
        </Link>
      </Panel>

      <DisciplineCard compact />

      <div className="grid grid-2 fold-split">
        <HoldingsCard className="fold-pane-a" />
        <div className="fold-pane-b" style={{ minWidth: 0 }}>
          <BenchmarkCard />
        </div>
      </div>

      <div className="grid grid-2">
        <QuickLink
          href="/app/trade"
          icon={<ArrowLeftRight size={18} />}
          title="Trade"
          body="Buy or sell against your cash balance."
        />
        <QuickLink
          href="/app/markets"
          icon={<LineChart size={18} />}
          title="Markets"
          body="Prices for your universe and holdings."
        />
        <QuickLink
          href="/app/allocate"
          icon={<PieChart size={18} />}
          title="Allocation"
          body="See how your capital is distributed."
        />
        <QuickLink
          href="/app/insights"
          icon={<Lightbulb size={18} />}
          title="Insights"
          body="Coaching tuned to your current portfolio."
        />
        <QuickLink
          href="/app/time-machine"
          icon={<History size={18} />}
          title="Time Machine"
          body="Replay the COVID crash, 2008 or 2021 with real prices."
        />
        <QuickLink
          href="/app/coach"
          icon={<MessageCircle size={18} />}
          title="Ask Sentia"
          body="Questions about your book, answered from your data."
        />
      </div>

      <Panel className="stack gap-sm">
        <RowLink
          href="/app/thesis"
          icon={<Lightbulb size={18} />}
          title="Investment theses"
          hint={`${state.theses.length} written`}
        />
      </Panel>

      <p className="disclaimer">
        Educational paper-trading only. Not investment advice. Data stays in your browser and is validated before every
        save.
      </p>
    </div>
  );
}

/** Top holdings at a glance (sits beside the benchmark chart; on a spanned foldable, one per pane). */
function HoldingsCard({ className }: { className?: string }) {
  const { summary, market } = useApp();
  const loading = market.status === "loading";
  const rows = summary ? [...summary.holdings].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5) : [];
  return (
    <Panel className={`stack gap-sm ${className ?? ""}`}>
      <div className="row between wrap gap-sm">
        <strong className="row gap-sm">
          <Briefcase size={17} /> Your holdings
        </strong>
        {rows.length ? (
          <Link href="/app/portfolio" className="btn btn-sm">
            See all
          </Link>
        ) : null}
      </div>
      {loading && rows.length ? (
        <RowsSkeleton rows={Math.min(3, rows.length)} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight size={24} />}
          title="No trades yet"
          hint="Your first practice trade takes about a minute. It's all play money."
          action={{ label: "Make your first trade", href: "/app/trade" }}
        />
      ) : (
        <div className="list">
          {rows.map((h) => (
            <Link key={h.symbol} href={`/app/trade?symbol=${encodeURIComponent(h.symbol)}`} className="list-row">
              <span className="sym-badge" aria-hidden="true">{h.symbol.slice(0, 4)}</span>
              <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                <strong>{h.symbol}</strong>
                <span className="small muted">{formatShareCount(h.shares)}</span>
              </div>
              <div className="stack" style={{ alignItems: "flex-end", gap: 2 }}>
                <strong>{formatCurrency(h.marketValue)}</strong>
                <span className={`small ${h.gain >= 0 ? "gain" : "loss"}`}>{formatPercent(h.gainPercent, true)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function QuickLink({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} className="panel holo stack gap-sm">
      <span className="trust-icon">{icon}</span>
      <strong>{title}</strong>
      <span className="small muted">{body}</span>
    </Link>
  );
}

function RowLink({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Link href={href} className="row between" style={{ padding: "6px 0" }}>
      <span className="row gap-sm">
        <span className="trust-icon" style={{ width: 34, height: 34 }}>
          {icon}
        </span>
        <strong>{title}</strong>
      </span>
      <span className="row gap-sm muted small">
        {hint} <ArrowRight size={16} />
      </span>
    </Link>
  );
}
