import assert from "node:assert/strict";
import { test } from "node:test";
import { biasReport, closedTrades, detectBiasEvents, dispositionEffect, previewTradeBiases } from "./biases";
import type { Transaction } from "./types";

const T0 = Date.parse("2026-10-01T14:00:00Z");
const H = 3_600_000;
let seq = 0;
function tx(type: "buy" | "sell", symbol: string, hours: number, price: number, extra: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    type,
    symbol,
    shares: 10,
    price,
    amount: 10 * price,
    cashAfter: 1000,
    note: "",
    createdAt: new Date(T0 + hours * H).toISOString(),
    ...extra,
  };
}

test("FOMO: buying on a +3% day, or at a fresh recent high after a run-up", () => {
  const events = detectBiasEvents([
    tx("buy", "NVDA", 0, 100, { dayChange: 4.2 }),
    tx("buy", "AAPL", 1, 100, { dayChange: 0.5 }),
    tx("buy", "AAPL", 48, 104, { dayChange: 0.2 }),
    tx("buy", "AAPL", 96, 108, { dayChange: 0.1 }), // new high, +8% vs low
  ]);
  const fomo = events.filter((e) => e.bias === "fomo");
  assert.equal(fomo.length, 2);
  assert.equal(fomo[0].symbol, "NVDA");
  assert.equal(fomo[1].symbol, "AAPL");
});

test("seeded opening positions are never flagged", () => {
  const events = detectBiasEvents([tx("buy", "VTI", 0, 100, { dayChange: 9, note: "Opening position" })]);
  assert.equal(events.length, 0);
});

test("revenge trade: a buy within 24h of a realized loss", () => {
  const events = detectBiasEvents([
    tx("buy", "TSLA", 0, 200),
    tx("sell", "TSLA", 5, 180, { realizedGain: -200 }),
    tx("buy", "GME", 10, 20),
    tx("buy", "AMD", 40, 20), // >24h after the loss
  ]);
  const revenge = events.filter((e) => e.bias === "revenge");
  assert.equal(revenge.length, 1);
  assert.equal(revenge[0].symbol, "GME");
});

test("panic sell: selling at a loss on a −3% day (not at a gain)", () => {
  const events = detectBiasEvents([
    tx("buy", "XOM", 0, 100),
    tx("sell", "XOM", 50, 90, { dayChange: -4, realizedGain: -100, shares: 5 }),
    tx("sell", "XOM", 100, 120, { dayChange: -5, realizedGain: 100, shares: 5 }),
  ]);
  assert.equal(events.filter((e) => e.bias === "panic").length, 1);
});

test("overtrading: 6 trades inside 24h, flagged once per window", () => {
  const list = Array.from({ length: 8 }, (_, i) => tx("buy", "SPY", i * 2, 500));
  const events = detectBiasEvents(list).filter((e) => e.bias === "overtrading");
  assert.equal(events.length, 1);
});

test("disposition effect: losers held longer than winners", () => {
  const list = [
    tx("buy", "AAA", 0, 10),
    tx("sell", "AAA", 24, 12, { realizedGain: 20 }), // winner held 1 day
    tx("buy", "BBB", 0, 10),
    tx("sell", "BBB", 24 * 10, 8, { realizedGain: -20 }), // loser held 10 days
  ];
  const closed = closedTrades(list);
  assert.equal(closed.length, 2);
  const d = dispositionEffect(closed);
  assert.equal(d.flagged, true);
  assert.ok((d.avgLoserHoldDays ?? 0) > (d.avgWinnerHoldDays ?? 0));
  assert.equal(d.lingeringLosers.length, 1);
  assert.equal(dispositionEffect(closed.slice(0, 1)).flagged, false);
});

test("biasReport counts only the last 30 days", () => {
  const now = T0 + 40 * 24 * H;
  const old = tx("buy", "NVDA", 0, 100, { dayChange: 5 });
  const recent = tx("buy", "MSFT", 35 * 24, 100, { dayChange: 5 });
  const report = biasReport([old, recent], now, 30);
  assert.equal(report.counts.fomo, 1);
  assert.equal(report.trades, 1);
  assert.equal(report.total, 1);
});

test("previewTradeBiases nudges before a trade without recording anything", () => {
  const history = [tx("buy", "TSLA", 0, 200), tx("sell", "TSLA", 2, 150, { realizedGain: -500 })];
  const nudges = previewTradeBiases(history, { side: "buy", symbol: "gme", shares: 1, price: 30, dayChange: 12 }, T0 + 3 * H);
  const keys = nudges.map((n) => n.bias).sort();
  assert.deepEqual(keys, ["fomo", "revenge"]);
  assert.match(nudges[0].body, /Buying|after/);
  const panic = previewTradeBiases(history, { side: "sell", symbol: "AAPL", shares: 1, price: 90, avgCost: 100, dayChange: -6 }, T0 + 3 * H);
  assert.deepEqual(panic.map((n) => n.bias), ["panic"]);
  assert.equal(history.length, 2);
});

test("starter prices are not a 'recent high' baseline and planned buys are not flagged", () => {
  const seeded = tx("buy", "VXUS", 0, 58.2, { note: "Opening position" });
  // Unplanned buy: only its own +4% day can flag it, never the seeded price.
  const unplanned = tx("buy", "VXUS", 1, 70, { dayChange: 0.5 });
  assert.equal(detectBiasEvents([seeded, unplanned]).length, 0);
  const planned = tx("buy", "VXUS", 2, 72, { dayChange: 5, plan: { why: "Diversify", exit: "Thesis break", risk: 20 } });
  assert.equal(detectBiasEvents([seeded, planned]).length, 0);
  const report = biasReport([seeded, planned], T0 + 3 * H);
  assert.equal(report.trades, 1);
  assert.equal(report.total, 0);
});

test("a planned buy right after a loss is not called a revenge trade", () => {
  const events = detectBiasEvents([
    tx("buy", "AAPL", 0, 100),
    tx("sell", "AAPL", 2, 90, { realizedGain: -100 }),
    tx("buy", "MSFT", 3, 100, { plan: { why: "Earnings thesis", exit: "Below 90", risk: 50 } }),
  ]);
  assert.equal(events.filter((e) => e.bias === "revenge").length, 0);
});

test("trade-page nudge uses the scored rule: planned and starter buys get no FOMO/revenge check", () => {
  const history = [tx("buy", "TSLA", 0, 200), tx("sell", "TSLA", 2, 150, { realizedGain: -500 })];
  const now = T0 + 3 * H;
  const cand = { side: "buy" as const, symbol: "VXUS", shares: 5, price: 70, dayChange: 3.8 };
  const plan = { why: "Diversify abroad", exit: "Sell if my thesis breaks", risk: 50 };

  // Planned buy: no nudge, and Insights scores the same trade with 0 flags.
  assert.deepEqual(previewTradeBiases(history, { ...cand, plan }, now), []);
  const placed = tx("buy", "VXUS", 3, 70, { dayChange: 3.8, plan });
  assert.equal(detectBiasEvents([...history, placed]).filter((e) => e.txId === placed.id).length, 0);

  // Starter trade: never flagged.
  assert.deepEqual(previewTradeBiases(history, { ...cand, note: "Opening position" }, now), []);

  // Checklist still to come: soft reminders only, saying it counts only if skipped.
  const soft = previewTradeBiases(history, { ...cand, checklistPending: true }, now);
  assert.deepEqual(soft.map((n) => n.bias).sort(), ["fomo", "revenge"]);
  assert.ok(soft.every((n) => n.soft === true));
  assert.match(soft[0].body, /won't count/);

  // Unplanned (checklist off or skipped): a real bias check, and Insights counts it too.
  const hard = previewTradeBiases(history, cand, now);
  assert.ok(hard.length > 0 && hard.every((n) => !n.soft));
  const skipped = tx("buy", "VXUS", 3, 70, { dayChange: 3.8 });
  assert.deepEqual(
    detectBiasEvents([...history, skipped]).filter((e) => e.txId === skipped.id).map((e) => e.bias).sort(),
    hard.map((n) => n.bias).sort(),
  );
});
