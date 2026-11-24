"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardCheck, NotebookPen, Star } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { TradePlan, Transaction } from "@/lib/types";
import { parseAmount } from "@/lib/validation";
import { Dialog } from "./dialog";

export type ChecklistDraft = {
  symbol: string;
  shares: number;
  price: number;
  suggestedRisk?: number;
  suggestedExit?: string;
  /** Set for a limit/stop buy, e.g. "Buy limit": the plan is saved with the order and the buy when it fills. */
  orderLabel?: string;
};

/** The 3 quick pre-trade questions shown before a buy. Answers are saved with the trade. */
export function PreTradeChecklist({
  draft,
  onConfirm,
  onSkip,
  onCancel,
}: {
  draft: ChecklistDraft | null;
  onConfirm: (plan: TradePlan) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={Boolean(draft)} onClose={onCancel} labelledBy="checklist-title" describedBy="checklist-desc">
      {draft ? <ChecklistForm key={`${draft.symbol}-${draft.shares}-${draft.price}`} draft={draft} onConfirm={onConfirm} onSkip={onSkip} onCancel={onCancel} /> : null}
    </Dialog>
  );
}

function ChecklistForm({ draft, onConfirm, onSkip, onCancel }: { draft: ChecklistDraft; onConfirm: (plan: TradePlan) => void; onSkip: () => void; onCancel: () => void }) {
  const [why, setWhy] = useState("");
  const [exit, setExit] = useState(draft.suggestedExit ?? "");
  const [risk, setRisk] = useState(draft.suggestedRisk ? draft.suggestedRisk.toFixed(2) : "");
  const [error, setError] = useState("");
  const cost = draft.shares * draft.price;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const riskNum = parseAmount(risk);
    if (!why.trim()) return setError("Add a short reason for buying.");
    if (!exit.trim()) return setError("Write down when you'd sell: a target, a stop, or what would break your idea.");
    if (riskNum === null || riskNum < 0) return setError("Enter how many dollars you're prepared to lose (0 or more).");
    if (riskNum > cost + 0.005) return setError(`That's more than the whole trade (${formatCurrency(cost)}).`);
    onConfirm({ why: why.trim(), exit: exit.trim(), risk: riskNum });
  };

  return (
    <form className="stack gap-md" onSubmit={submit}>
      <div className="row gap-sm">
        <span className="tour-icon" aria-hidden="true">
          <ClipboardCheck size={22} />
        </span>
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow">Pre-trade checklist</span>
          <h2 id="checklist-title" style={{ fontSize: "1.3rem" }}>
            {draft.orderLabel ?? "Buy"} {formatNumber(draft.shares)} {draft.symbol}
          </h2>
        </div>
      </div>
      <p id="checklist-desc" className="small muted" style={{ margin: 0 }}>
        About {formatCurrency(cost)} at {formatCurrency(draft.price)}
        {draft.orderLabel ? " (your order price)" : ""}. Three quick answers, saved with the trade so you can check them later.
      </p>
      <div className="field">
        <label htmlFor="cl-why">1. Why are you buying?</label>
        <textarea id="cl-why" className="textarea" rows={2} maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Strong earnings growth, and I've written a thesis" data-autofocus />
      </div>
      <div className="field">
        <label htmlFor="cl-exit">2. What&apos;s your exit plan?</label>
        <textarea id="cl-exit" className="textarea" rows={2} maxLength={300} value={exit} onChange={(e) => setExit(e.target.value)} placeholder="e.g. Sell if it closes below $180 or the thesis breaks" />
      </div>
      <div className="field">
        <label htmlFor="cl-risk">3. How much are you willing to lose? ($)</label>
        <input id="cl-risk" className="input" inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} placeholder="e.g. 100" />
        <span className="small dim">Tip: the position sizer on this page works this out from a stop price.</span>
      </div>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
      <div className="row between wrap gap-sm">
        <span className="row gap-sm">
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-sm" onClick={onSkip}>
            Skip this time
          </button>
        </span>
        <button type="submit" className="btn btn-primary">
          {draft.orderLabel ? "Save plan & place order" : "Save plan & buy"}
        </button>
      </div>
      <span className="small dim">
        You can turn the checklist off in <Link href="/app/settings" className="text-link">Settings</Link>. Simulated trade, not investment advice.
      </span>
    </form>
  );
}

/** 1–5 stars, as a radio group. */
export function StarRating({ value, onChange, idPrefix }: { value: number; onChange: (v: number) => void; idPrefix: string }) {
  return (
    <div className="star-rating" role="radiogroup" aria-label="Rate this trade from 1 to 5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          id={`${idPrefix}-${n}`}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className={`star-rating-btn ${n <= value ? "on" : ""}`}
          onClick={() => onChange(n)}
        >
          <Star size={24} fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

/** Rate a closed trade and note a lesson (shown after a sell, and from the Journal). */
export function TradeReviewDialog({
  tx,
  onSave,
  onClose,
}: {
  tx: Transaction | null;
  onSave: (rating: number, lesson: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(tx)} onClose={onClose} labelledBy="review-title" describedBy="review-desc">
      {tx ? <ReviewForm key={tx.id} tx={tx} onSave={onSave} onClose={onClose} /> : null}
    </Dialog>
  );
}

function ReviewForm({ tx, onSave, onClose }: { tx: Transaction; onSave: (rating: number, lesson: string) => void; onClose: () => void }) {
  const [rating, setRating] = useState(tx.review?.rating ?? 0);
  const [lesson, setLesson] = useState(tx.review?.lesson ?? "");
  const [error, setError] = useState("");
  const gain = tx.realizedGain ?? 0;
  return (
    <form
      className="stack gap-md"
      onSubmit={(e) => {
        e.preventDefault();
        if (rating < 1) return setError("Tap a star rating first.");
        onSave(rating, lesson);
      }}
    >
      <div className="row gap-sm">
        <span className="tour-icon" aria-hidden="true">
          <NotebookPen size={22} />
        </span>
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow">Post-trade review</span>
          <h2 id="review-title" style={{ fontSize: "1.3rem" }}>
            How did this {tx.symbol} trade go?
          </h2>
        </div>
      </div>
      <p id="review-desc" className="small muted" style={{ margin: 0 }}>
        Sold {formatNumber(tx.shares ?? 0)} at {formatCurrency(tx.price ?? 0)} for a{" "}
        <span className={gain >= 0 ? "gain" : "loss"}>{formatCurrency(gain)}</span> {gain >= 0 ? "gain" : "loss"}. Rate the{" "}
        <em>decision</em>, not just the result: a good process can still lose money.
      </p>
      <StarRating value={rating} onChange={setRating} idPrefix={`rate-${tx.id}`} />
      <div className="field">
        <label htmlFor="review-lesson">One lesson for next time</label>
        <textarea id="review-lesson" className="textarea" rows={3} maxLength={500} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="e.g. I sold early because I was nervous. Next time, stick to the exit plan." />
      </div>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
      <div className="row between wrap gap-sm">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Later
        </button>
        <button type="submit" className="btn btn-primary">
          Save review
        </button>
      </div>
    </form>
  );
}
