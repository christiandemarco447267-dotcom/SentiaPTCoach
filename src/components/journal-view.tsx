"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardCheck, ClipboardList, Download, NotebookPen, Star } from "lucide-react";
import { isDecisionTrade } from "@/lib/biases";
import { downloadText, transactionsCsv } from "@/lib/csv";
import { formatCurrency, formatNumber, formatRelativeDay } from "@/lib/format";
import { localDayKey } from "@/lib/market";
import { useApp } from "@/lib/store";
import { EmptyState, Loading, Panel, PageHeader } from "./ui";
import { TradeReviewDialog } from "./trade-journal-dialogs";

type Tab = "reviews" | "plans";

/** Trade journal: post-trade reviews (and sells still waiting for one) plus the plans saved with buys. */
export function JournalView() {
  const { ready, state, actions } = useApp();
  const [tab, setTab] = useState<Tab>("reviews");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  if (!ready || !state) return <Loading />;

  const trades = state.transactions.filter(isDecisionTrade);
  const sells = trades.filter((t) => t.type === "sell").reverse();
  const reviewed = sells.filter((t) => t.review);
  const waiting = sells.filter((t) => !t.review);
  const buys = trades.filter((t) => t.type === "buy").reverse();
  const planned = buys.filter((t) => t.plan);
  const avg = reviewed.length ? reviewed.reduce((s, t) => s + (t.review?.rating ?? 0), 0) / reviewed.length : null;
  const reviewTx = reviewId ? (state.transactions.find((t) => t.id === reviewId) ?? null) : null;

  return (
    <div className="stack gap-lg animate-in">
      <PageHeader
        title="Trade journal"
        subtitle="Your plans before each buy and your reviews after each sell, in one place."
        action={
          <button type="button" className="btn btn-sm" onClick={() => downloadText(`sentia-trades-${localDayKey(new Date())}.csv`, transactionsCsv(state))}>
            <Download size={15} /> Export CSV
          </button>
        }
      />

      <div className="bench-stats bench-stats-4">
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">Reviews</span>
          <strong>{reviewed.length}</strong>
        </div>
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">Avg rating</span>
          <strong>{avg === null ? "—" : `${avg.toFixed(1)} / 5`}</strong>
        </div>
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">Waiting for review</span>
          <strong className={waiting.length ? "loss" : ""}>{waiting.length}</strong>
        </div>
        <div className="bench-stat stack" style={{ gap: 2 }}>
          <span className="small muted">Buys with a plan</span>
          <strong>
            {planned.length}/{buys.length}
          </strong>
        </div>
      </div>

      <div className="segmented" role="tablist" aria-label="Journal sections" style={{ width: "fit-content" }}>
        <button type="button" role="tab" aria-selected={tab === "reviews"} className={tab === "reviews" ? "active" : ""} onClick={() => setTab("reviews")}>
          Reviews
        </button>
        <button type="button" role="tab" aria-selected={tab === "plans"} className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>
          Plans
        </button>
      </div>

      {message ? <span className="form-ok">{message}</span> : null}

      {tab === "reviews" ? (
        <>
          {waiting.length ? (
            <Panel className="stack gap-md">
              <strong className="row gap-sm">
                <NotebookPen size={17} /> Waiting for your review
              </strong>
              <div className="list">
                {waiting.slice(0, 20).map((t) => (
                  <div key={t.id} className="list-row">
                    <span className="sym-badge">{t.symbol}</span>
                    <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                      <strong>
                        Sold {formatNumber(t.shares ?? 0)} @ {formatCurrency(t.price ?? 0)}
                      </strong>
                      <span className="small dim">
                        {formatRelativeDay(t.createdAt)} · <span className={(t.realizedGain ?? 0) >= 0 ? "gain" : "loss"}>{formatCurrency(t.realizedGain ?? 0)}</span>
                      </span>
                    </div>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setReviewId(t.id)}>
                      Review
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
          <Panel className="stack gap-md">
            <strong className="row gap-sm">
              <Star size={17} /> Reviewed trades
            </strong>
            {reviewed.length === 0 ? (
              <EmptyState icon={<NotebookPen size={24} />} title="Your journal is empty" hint="After you sell, Sentia asks you to rate the trade and note one lesson. Your reviews collect here." action={{ label: "Go to Trade", href: "/app/trade" }} />
            ) : (
              <div className="list">
                {reviewed.map((t) => (
                  <div key={t.id} className="list-row" style={{ alignItems: "flex-start" }}>
                    <span className="sym-badge">{t.symbol}</span>
                    <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
                      <div className="row between wrap gap-sm">
                        <span className="stars" aria-label={`${t.review?.rating} out of 5 stars`}>
                          {"★".repeat(t.review?.rating ?? 0)}
                          <span className="dim">{"★".repeat(5 - (t.review?.rating ?? 0))}</span>
                        </span>
                        <span className={(t.realizedGain ?? 0) >= 0 ? "gain small" : "loss small"}>{formatCurrency(t.realizedGain ?? 0)}</span>
                      </div>
                      {t.review?.lesson ? <span className="small">“{t.review.lesson}”</span> : <span className="small dim">No lesson written.</span>}
                      <span className="small dim row wrap gap-sm">
                        {formatRelativeDay(t.createdAt)} · sold {formatNumber(t.shares ?? 0)} @ {formatCurrency(t.price ?? 0)}
                        <button type="button" className="link-btn small" onClick={() => setReviewId(t.id)}>
                          Edit
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      ) : (
        <Panel className="stack gap-md">
          <strong className="row gap-sm">
            <ClipboardCheck size={17} /> Plans saved with your buys
          </strong>
          {planned.length === 0 ? (
            <EmptyState icon={<ClipboardList size={24} />} title="No plans yet" hint="Before a buy, the pre-trade checklist asks why, your exit plan and your risk. Answers show up here." action={{ label: "Plan a trade", href: "/app/trade" }} />
          ) : (
            <div className="list">
              {planned.map((t) => (
                <div key={t.id} className="list-row" style={{ alignItems: "flex-start" }}>
                  <span className="sym-badge">{t.symbol}</span>
                  <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
                    <strong>
                      Bought {formatNumber(t.shares ?? 0)} @ {formatCurrency(t.price ?? 0)}
                    </strong>
                    <span className="small">
                      <span className="muted">Why:</span> {t.plan?.why}
                    </span>
                    <span className="small">
                      <span className="muted">Exit:</span> {t.plan?.exit}
                    </span>
                    <span className="small">
                      <span className="muted">Risk:</span> {formatCurrency(t.plan?.risk ?? 0)} · <span className="dim">{formatRelativeDay(t.createdAt)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <span className="small dim">
            Checklist on or off: <Link href="/app/settings" className="text-link">Settings</Link>.
          </span>
        </Panel>
      )}

      <TradeReviewDialog
        tx={reviewTx}
        onClose={() => setReviewId(null)}
        onSave={(rating, lesson) => {
          if (reviewTx) {
            try {
              actions.reviewTrade(reviewTx.id, { rating, lesson });
              setMessage("Review saved.");
            } catch (err) {
              setMessage(err instanceof Error ? err.message : "Couldn't save the review.");
            }
          }
          setReviewId(null);
        }}
      />
      <p className="disclaimer">Simulated paper trading. No real money. Not investment advice.</p>
    </div>
  );
}
