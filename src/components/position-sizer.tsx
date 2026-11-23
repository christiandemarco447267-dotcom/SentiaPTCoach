"use client";

import { useState } from "react";
import { Calculator, ChevronDown } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/format";
import { positionSize } from "@/lib/position-size";
import { parseAmount } from "@/lib/validation";
import { Panel } from "./ui";

/**
 * "How many shares?" from account size, risk %, entry and stop. Fractional shares
 * are allowed (rounded down to 4 decimals so the risk is never exceeded).
 */
export function PositionSizer({
  accountValue,
  cash,
  entryPrice,
  symbol,
  onUse,
}: {
  accountValue: number;
  cash: number;
  entryPrice?: number;
  symbol: string;
  onUse: (r: { shares: number; risk: number; stop: number; entry: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [riskPct, setRiskPct] = useState("1");
  const [entry, setEntry] = useState<string | null>(null);
  const [stop, setStop] = useState("");

  const accountText = account ?? (accountValue > 0 ? accountValue.toFixed(2) : "");
  const entryText = entry ?? (entryPrice ? entryPrice.toFixed(2) : "");
  const result = positionSize({
    account: parseAmount(accountText) ?? NaN,
    riskPct: parseAmount(riskPct) ?? NaN,
    entry: parseAmount(entryText) ?? NaN,
    stop: parseAmount(stop) ?? NaN,
    cash,
  });
  const ready = stop.trim() !== "" && entryText.trim() !== "";

  return (
    <Panel className="stack gap-md sizer">
      <button type="button" className="sizer-toggle row between" aria-expanded={open} aria-controls="sizer-body" onClick={() => setOpen((v) => !v)}>
        <span className="row gap-sm">
          <Calculator size={18} /> <strong>Position sizer</strong>
        </span>
        <span className="row gap-sm small muted">
          How many shares?
          <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
        </span>
      </button>
      <div id="sizer-body" className="stack gap-md" hidden={!open}>
        <span className="small muted" style={{ marginTop: -6 }}>
          Risk a set share of your account between your entry and your stop. Shares = (account × risk %) ÷ (entry − stop).
        </span>
        <div className="grid grid-2 sizer-grid">
          <div className="field">
            <label htmlFor="sz-account">Account size ($)</label>
            <input id="sz-account" className="input" inputMode="decimal" value={accountText} onChange={(e) => setAccount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sz-risk">Risk per trade (%)</label>
            <input id="sz-risk" className="input" inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sz-entry">Entry price ($)</label>
            <input id="sz-entry" className="input" inputMode="decimal" value={entryText} onChange={(e) => setEntry(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field">
            <label htmlFor="sz-stop">Stop price ($)</label>
            <input id="sz-stop" className="input" inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="Below entry" />
          </div>
        </div>
        <div aria-live="polite">
          {!ready ? (
            <span className="small dim">Enter a stop price to see a suggested size{symbol ? ` for ${symbol}` : ""}.</span>
          ) : result.ok ? (
            <div className="stack gap-sm">
              <div className="sizer-result">
                <span className="small muted">Suggested size</span>
                <strong className="value-lg">{formatNumber(result.shares)} shares</strong>
                <span className="small muted">
                  Costs {formatCurrency(result.cost)} ({result.pctOfAccount.toFixed(1)}% of account). If the stop hits you lose about {formatCurrency(result.riskAmount)} ({formatCurrency(result.perShareRisk)}/share).
                </span>
              </div>
              {result.exceedsCash ? (
                <span className="small loss">
                  That&apos;s more than your {formatCurrency(cash)} cash. You could afford about {formatNumber(result.affordableShares ?? 0)} shares.
                </span>
              ) : null}
              <button
                type="button"
                className="btn btn-sm"
                style={{ width: "fit-content" }}
                onClick={() =>
                  onUse({
                    shares: result.exceedsCash ? (result.affordableShares ?? 0) : result.shares,
                    risk: result.riskAmount,
                    stop: parseAmount(stop) ?? 0,
                    entry: parseAmount(entryText) ?? 0,
                  })
                }
              >
                Use {formatNumber(result.exceedsCash ? (result.affordableShares ?? 0) : result.shares)} shares
              </button>
            </div>
          ) : (
            <span className="small form-error">{result.error}</span>
          )}
        </div>
        <span className="small dim">Practice math for paper trades, not investment advice.</span>
      </div>
    </Panel>
  );
}
