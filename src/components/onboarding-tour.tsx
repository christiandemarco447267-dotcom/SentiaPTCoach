"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, MessageCircle, Sparkles, Target } from "lucide-react";
import { track } from "@/lib/analytics";
import { assessState } from "@/lib/experience";
import { quickStartCoachText } from "@/lib/quick-start";
import { formatCurrency, formatNumber } from "@/lib/format";
import { DEFAULT_AMOUNT, GOAL_OPTIONS, picksForGoals } from "@/lib/goals";
import { demoQuote, nameForSymbol } from "@/lib/market";
import { floorShares } from "@/lib/position-size";
import { quoteMap } from "@/lib/portfolio";
import { SIM_DISCLAIMER } from "@/lib/site";
import { useApp } from "@/lib/store";
import type { PracticeGoal } from "@/lib/types";
import { MultiChoice } from "./multi-choice";

/**
 * Guided first session (~60 seconds): 1) pick a practice goal, 2) make a first
 * (paper) trade with its three-question plan, 3) meet the coach. Opens once for new
 * users after profile setup; skippable at every step and re-launchable from Settings.
 */
const STEPS = [
  { key: "goal", icon: Target, label: "Pick a goal" },
  { key: "trade", icon: ArrowLeftRight, label: "First trade" },
  { key: "coach", icon: MessageCircle, label: "Meet the coach" },
] as const;

const AMOUNTS = [250, 500, 1000];

export function OnboardingTour() {
  const { tourOpen } = useApp();
  if (!tourOpen) return null;
  return <GuidedSession />;
}

function GuidedSession() {
  const { state, summary, quotes, market, closeTour, actions } = useApp();
  const [step, setStep] = useState(0);
  const [goals, setGoals] = useState<PracticeGoal[]>(() => [...(state?.profile.goals ?? [])]);
  const picks = picksForGoals(goals);
  const [symbol, setSymbol] = useState(picks[0]);
  const [amount, setAmount] = useState(() => (state ? DEFAULT_AMOUNT[assessState(state).tier] : 500));
  const [why, setWhy] = useState("");
  const [bought, setBought] = useState<{ symbol: string; shares: number; price: number } | null>(null);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<() => void>(() => undefined);

  const finish = () => {
    try {
      actions.completeOnboarding();
    } catch {
      // store not ready: just close
    }
    closeTour();
  };
  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    dialogRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finishRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const prices = useMemo(() => quoteMap(quotes), [quotes]);
  const live = market.feed === "live";
  const quote = prices.get(symbol) ?? (!live ? demoQuote(symbol) : undefined);
  const price = quote?.price;
  const shares = price ? floorShares(amount / price) : 0;

  const coachText = useMemo(() => {
    if (!state || !summary || step !== 2) return "";
    try {
      return quickStartCoachText({ bought, cash: summary.cash, total: summary.total, holdings: summary.holdings.length, goals });
    } catch {
      return "";
    }
  }, [state, summary, step, bought, goals]);

  if (!state) return null;
  const S = STEPS[step];
  const Icon = S.icon;

  const chooseGoals = (next: PracticeGoal[]) => {
    setGoals(next);
    const nextPicks = picksForGoals(next);
    if (!nextPicks.includes(symbol)) setSymbol(nextPicks[0]);
  };

  const nextFromGoal = () => {
    if (goals.length) {
      try {
        actions.setGoals(goals);
      } catch {
        // keep going
      }
    }
    setStep(1);
  };

  const placeTrade = () => {
    setError("");
    if (!price || shares <= 0) return setError(live ? `No live price for ${symbol} right now. Pick another or skip this step.` : "Pick a stock first.");
    if (!why.trim()) return setError("Add a few words on why. It's the first of the three plan questions.");
    try {
      actions.buy({
        symbol,
        shares,
        price,
        dayChange: quote?.changePercent,
        plan: { why: why.trim(), exit: `Review in one week; sell if it falls 10% (about ${formatCurrency(price * 0.9)}).`, risk: Math.round(shares * price * 10) / 100 },
      });
      track("trade_placed");
      setBought({ symbol, shares, price });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That trade couldn't be placed.");
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) finish();
      }}
    >
      <div ref={dialogRef} className="modal stack gap-md guided" role="dialog" aria-modal="true" aria-labelledby="guided-title" tabIndex={-1}>
        <div className="row between">
          <span className="eyebrow">
            Quick start · {step + 1} of {STEPS.length} · about a minute
          </span>
          <button type="button" className="btn btn-sm" onClick={finish} aria-label="Skip the guided session">
            Skip
          </button>
        </div>
        <div className="guided-steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.key} className={clsx("guided-step", i === step && "active", i < step && "done")}>
              {s.label}
            </span>
          ))}
        </div>

        {step === 0 ? (
          <div className="stack gap-md">
            <div className="row gap-sm">
              <span className="tour-icon">
                <Icon size={22} />
              </span>
              <h2 id="guided-title" style={{ fontSize: "1.35rem" }}>
                What do you want to practice?
              </h2>
            </div>
            <MultiChoice options={GOAL_OPTIONS} selected={goals} onChange={chooseGoals} labelledBy="guided-title" min={1} />
            <p className="sim-disclaimer" role="note">
              {SIM_DISCLAIMER}
            </p>
            <div className="row between">
              <span className="small dim">{goals.length > 1 ? "Your goals pin matching challenges." : "Your goal pins a matching challenge."}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={nextFromGoal} disabled={!goals.length}>
                Next
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="stack gap-md">
            <div className="row gap-sm">
              <span className="tour-icon">
                <Icon size={22} />
              </span>
              <h2 id="guided-title" style={{ fontSize: "1.35rem" }}>
                {bought ? "Nice. That's your first trade." : "Make your first paper trade"}
              </h2>
            </div>
            {bought ? (
              <div className="stack gap-sm">
                <p className="muted" style={{ margin: 0 }}>
                  You bought <strong>{formatNumber(bought.shares)} shares of {bought.symbol}</strong> at {formatCurrency(bought.price)} with play money. Your
                  reason, exit plan and risk were saved with it, so you can check yourself later in the Trade journal.
                </p>
                <span className="small dim">Fractional shares are fine in Sentia, so any amount works.</span>
              </div>
            ) : (
              <>
                <span className="small muted">Pick one and an amount. It uses {live ? "the real market price" : "a simulated practice price"}; no real money moves.</span>
                <div className="row wrap gap-sm" role="group" aria-label="Stock">
                  {picks.map((s) => (
                    <button key={s} type="button" className={clsx("chip guided-chip", symbol === s && "chip-on")} aria-pressed={symbol === s} onClick={() => setSymbol(s)}>
                      <strong>{s}</strong> <span className="small muted">{nameForSymbol(s).replace(/,? Inc\.|Corporation| ETF.*$/g, "").trim()}</span>
                    </button>
                  ))}
                </div>
                <div className="segmented" role="group" aria-label="Amount">
                  {AMOUNTS.map((a) => (
                    <button key={a} type="button" className={amount === a ? "active" : ""} aria-pressed={amount === a} onClick={() => setAmount(a)}>
                      {formatCurrency(a).replace(".00", "")}
                    </button>
                  ))}
                </div>
                <span className="small">
                  {price ? (
                    <>
                      ≈ <strong>{formatNumber(shares)} shares</strong> at {formatCurrency(price)}
                    </>
                  ) : (
                    <span className="loss">No live price for {symbol} yet.</span>
                  )}
                </span>
                <div className="field">
                  <label htmlFor="guided-why">Why this one? (the reason in your trade plan)</label>
                  <input id="guided-why" className="input" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. I use their products every day" />
                  <span className="small dim">We&apos;ll fill in a starter exit plan (review in a week, or sell after a 10% drop) and a 10% risk amount.</span>
                </div>
                {error ? (
                  <span className="form-error" role="alert">
                    {error}
                  </span>
                ) : null}
              </>
            )}
            <div className="row between">
              <button type="button" className="btn btn-sm" onClick={() => setStep(0)}>
                Back
              </button>
              <span className="row gap-sm">
                {bought ? null : (
                  <button type="button" className="btn btn-sm" onClick={() => setStep(2)}>
                    Skip trade
                  </button>
                )}
                {bought ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep(2)}>
                    Next
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" onClick={placeTrade}>
                    Buy {symbol}
                  </button>
                )}
              </span>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="stack gap-md">
            <div className="row gap-sm">
              <span className="tour-icon">
                <Sparkles size={22} />
              </span>
              <h2 id="guided-title" style={{ fontSize: "1.35rem" }}>
                Meet your coach
              </h2>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Ask Sentia reads your paper account and answers from your own numbers. Here&apos;s what it sees right now:
            </p>
            {coachText ? <div className="bubble bubble-coach guided-bubble">{coachText}</div> : null}
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Every Monday you get a report card with a grade and one tip.</li>
              <li>Challenges earn badges for good habits.</li>
            </ul>
            <span className="small dim">Educational only, not investment advice. Replay this anytime from Settings.</span>
            <div className="row between">
              <button type="button" className="btn btn-sm" onClick={() => setStep(1)}>
                Back
              </button>
              <span className="row gap-sm">
                <Link href="/app/coach" className="btn btn-sm" onClick={finish}>
                  Ask a question
                </Link>
                <button type="button" className="btn btn-primary btn-sm" onClick={finish}>
                  Done
                </button>
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
