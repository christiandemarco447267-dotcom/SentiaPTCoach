"use client";

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { Award, BellRing, CircleCheck, CircleX, Clock3, FlaskConical, Radio, Star, X } from "lucide-react";
import { quoteBadge } from "@/lib/live-quotes";
import { priceSourceOf, sparklineForSymbol } from "@/lib/market";
import type { Quote } from "@/lib/types";
import { useApp } from "@/lib/store";

export function Loading({ label }: { label?: string }) {
  // Without a label this is the workspace placeholder: a page-shaped shimmer so nothing jumps when data arrives.
  if (!label) return <PageSkeleton />;
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="small">{label}</span>
    </div>
  );
}

/** A shimmering placeholder block. Decorative; pair it with a status label for screen readers. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={clsx("skeleton", className)} style={style} aria-hidden="true" />;
}

/** Inline price placeholder while quotes load. */
export function PriceSkeleton({ width }: { width?: string }) {
  return (
    <>
      <Skeleton className="skeleton-price" style={width ? { width } : undefined} />
      <span className="sr-only">Loading price</span>
    </>
  );
}

/** Chart-shaped placeholder that reserves the chart's height (no layout shift). */
export function ChartSkeleton({ height = 150 }: { height?: number }) {
  return (
    <div role="status" aria-label="Loading chart">
      <Skeleton className="skeleton-chart" style={{ height, minHeight: height, aspectRatio: "auto" }} />
    </div>
  );
}

/** List rows placeholder (symbol dot, name, price). */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <Skeleton className="skeleton-dot" />
          <span className="stack" style={{ gap: 6 }}>
            <Skeleton className="skeleton-text" style={{ width: "40%" }} />
            <Skeleton className="skeleton-text" style={{ width: "65%" }} />
          </span>
          <Skeleton className="skeleton-text" />
        </div>
      ))}
    </div>
  );
}

/** Whole-page placeholder shown while the workspace hydrates from storage. */
export function PageSkeleton() {
  return (
    <div className="stack gap-lg" role="status" aria-live="polite">
      <span className="sr-only">Loading your workspace…</span>
      <div className="stack gap-sm">
        <Skeleton className="skeleton-text" style={{ width: 120 }} />
        <Skeleton style={{ width: "min(320px, 80%)", height: 32 }} />
      </div>
      <div className="panel stack gap-md">
        <Skeleton className="skeleton-text" style={{ width: 140 }} />
        <Skeleton style={{ width: "min(240px, 70%)", height: 40 }} />
        <ChartSkeleton height={150} />
      </div>
      <div className="panel">
        <RowsSkeleton rows={3} />
      </div>
    </div>
  );
}

export function Panel({
  children,
  className,
  strong,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return <div className={clsx("panel", strong && "panel-strong", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="row between wrap gap-md" style={{ marginBottom: 20 }}>
      <div className="page-header">
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "gain" | "loss" }) {
  return (
    <Panel className="holo stack gap-sm">
      <span className="eyebrow">{label}</span>
      <span className={clsx("value-lg", tone)}>{value}</span>
      {hint ? <span className="small muted">{hint}</span> : null}
    </Panel>
  );
}

type EmptyAction = { label: string; href?: string; onClick?: () => void; icon?: ReactNode };

/**
 * Friendly empty state. With an `action` (and optional `icon`) it becomes a centered card with a
 * call-to-action button; without one it stays the compact muted note used inside dense panels.
 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
  secondary,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: EmptyAction;
  secondary?: EmptyAction;
}) {
  if (!action && !icon) {
    return (
      <div className="empty stack gap-sm">
        <strong>{title}</strong>
        {hint ? <span className="small">{hint}</span> : null}
      </div>
    );
  }
  return (
    <div className="empty-cta">
      {icon ? (
        <span className="empty-cta-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h3>{title}</h3>
      {hint ? <p className="small">{hint}</p> : null}
      {action || secondary ? (
        <div className="row gap-sm">
          {action ? <EmptyButton action={action} primary /> : null}
          {secondary ? <EmptyButton action={secondary} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyButton({ action, primary }: { action: EmptyAction; primary?: boolean }) {
  const cls = clsx("btn btn-sm", primary && "btn-primary");
  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {action.icon}
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={action.onClick}>
      {action.icon}
      {action.label}
    </button>
  );
}

export function Sparkline({ symbol, width = 88, height = 30 }: { symbol: string; width?: number; height?: number }) {
  const series = sparklineForSymbol(symbol, 24);
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const step = width / (series.length - 1);
  const points = series
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const rising = series[series.length - 1] >= series[0];
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={rising ? "var(--gain)" : "var(--loss)"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Small "Demo prices" badge, shown only while market data is simulated (no live
 * service configured, or the configured one is unreachable). Renders nothing for
 * real prices — each quote then carries its own "Real price" / "Real price · delayed" badge.
 */
export function DemoPricesBadge({ className }: { className?: string }) {
  const { market } = useApp();
  const source = priceSourceOf(market);
  if (source !== "demo" && source !== "mixed") return null;
  const unreachable = market.demoReason === "unreachable";
  const text = source === "mixed" ? "Some prices simulated" : unreachable ? "Demo prices · live offline" : "Demo prices";
  const detail =
    source === "mixed"
      ? "Live quotes were unavailable for some symbols, so those prices are simulated."
      : unreachable
        ? "The live price service couldn't be reached, so prices are simulated for now. Orders and alerts are paused until live prices return."
        : "Prices are simulated for practice. They are not real market data.";
  return (
    <span className={clsx("pill pill-demo", className)} role="status" title={detail}>
      <FlaskConical size={13} />
      {text}
      <span className="sr-only">. {detail}</span>
    </span>
  );
}

/** Per-quote data badge: Real price / Real price · delayed / Demo, with an "as of" time (America/New_York) on hover and for screen readers. */
export function QuoteBadge({ quote, showTime = false, className }: { quote: Quote | undefined; showTime?: boolean; className?: string }) {
  const badge = quoteBadge(quote);
  const time = showTime ? badge.when : "";
  return (
    <span className={clsx("quote-badge", `quote-badge-${badge.kind}`, className)} title={badge.detail}>
      {badge.kind === "live" ? <Radio size={11} /> : badge.kind === "delayed" ? <Clock3 size={11} /> : <FlaskConical size={11} />}
      {badge.label}
      {time ? <span className="quote-badge-time"> · {time}</span> : null}
      <span className="sr-only">. {badge.detail}</span>
    </span>
  );
}

/** Star / unstar a ticker on the watchlist. */
export function StarButton({ symbol, withLabel }: { symbol: string; withLabel?: boolean }) {
  const { state, actions } = useApp();
  if (!state) return null;
  const upper = symbol.trim().toUpperCase();
  const watched = state.watchlist.some((w) => w.toUpperCase() === upper);
  const label = watched ? `Remove ${upper} from watchlist` : `Add ${upper} to watchlist`;
  return (
    <button
      type="button"
      className={clsx("btn btn-sm star-btn", watched && "starred", !withLabel && "btn-icon")}
      onClick={() => {
        try {
          actions.toggleWatch(upper);
        } catch {
          // Watchlist full or invalid symbol: nothing to toggle.
        }
      }}
      aria-pressed={watched}
      aria-label={label}
      title={label}
    >
      <Star size={15} fill={watched ? "currentColor" : "none"} />
      {withLabel ? (watched ? "Watching" : "Watch") : null}
    </button>
  );
}

/** Stack of in-app notifications (order fills, price alerts). */
export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-host" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={clsx("toast", `toast-${toast.tone}`, toast.fx === "badge" && "badge-earned-fx")} role="status">
          <span className="toast-icon" aria-hidden="true">
            {toast.fx === "badge" ? <Award size={18} /> : toast.tone === "gain" ? <CircleCheck size={18} /> : toast.tone === "loss" ? <CircleX size={18} /> : <BellRing size={18} />}
          </span>
          <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
            <strong>{toast.title}</strong>
            <span className="small muted">{toast.body}</span>
          </span>
          <button type="button" className="btn btn-icon btn-sm" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
