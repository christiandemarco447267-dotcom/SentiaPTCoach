import assert from "node:assert/strict";
import { test } from "node:test";
import { marketGapSentence, marketStandingLabel, winRateHint } from "./benchmark";

// A2: report card and Portfolio share one ±0.05-pt "even" rule.
test("marketGapSentence: tied reads as even, never 'ahead by 0.00'", () => {
  assert.equal(marketGapSentence(0), "Even with the S&P 500 this week.");
  assert.equal(marketGapSentence(0.04), "Even with the S&P 500 this week.");
  assert.equal(marketGapSentence(-0.049), "Even with the S&P 500 this week.");
  assert.equal(marketGapSentence(1.2), "Ahead of the S&P 500 by 1.20 points this week.");
  assert.equal(marketGapSentence(-0.5, "this month"), "Behind the S&P 500 by 0.50 points this month.");
  assert.equal(marketStandingLabel(0.04), "Even with the market");
});

// A8: break-even only, no decided trades.
test("winRateHint with only break-even sells reads cleanly", () => {
  const hint = winRateHint({ wins: 0, losses: 0, breakeven: 1, closed: 0, percent: null });
  assert.equal(hint, "No wins or losses yet · 1 break-even");
  assert.doesNotMatch(hint, /not counted/);
});

// A4: the starter banner's amount follows the live account, not a stale number.
import { buy, createInitialState, freshStartAmount, freshStartCash, startFresh } from "./storage";
test("freshStartAmount reads the live account total, falling back to the opening deposit", () => {
  const s0 = createInitialState();
  assert.equal(freshStartAmount(s0), freshStartCash(s0));
  const s1 = buy(s0, { symbol: "AAPL", shares: 2, price: 200 });
  assert.equal(freshStartAmount(s1, 41_812.4), 41_812);
  assert.equal(freshStartAmount(s1, Number.NaN), freshStartCash(s1));
  const fresh = startFresh(s1, freshStartAmount(s1, 41_812.4));
  assert.equal(fresh.cash, 41_812);
  assert.equal(fresh.holdings.length, 0);
});

// A6: "/" opens search, "?" / Shift+/ opens the shortcuts sheet.
import { resolveShortcut } from "./shortcuts";
test("Shift+/ opens shortcuts help, plain / opens search", () => {
  const idle = { pendingG: null };
  assert.equal(resolveShortcut({ key: "/" }, null, idle, 0).action?.kind, "search");
  assert.equal(resolveShortcut({ key: "?", shiftKey: true, code: "Slash" }, null, idle, 0).action?.kind, "help");
  assert.equal(resolveShortcut({ key: "/", shiftKey: true, code: "Slash" }, null, idle, 0).action?.kind, "help");
  assert.equal(resolveShortcut({ key: "?" }, null, idle, 0).action?.kind, "help");
});

// A7: readable dates in the AI context; built-in bullets end with periods.
import { coachDay } from "./coach-context";
import { asSentence, ruleBasedAnswer } from "./coach";
import { summarizePortfolio } from "./portfolio";
test("coach context dates read 'Nov 23, 2026' and built-in bullets end with a period", () => {
  assert.equal(coachDay(new Date(2026, 10, 23, 12).toISOString()), "Nov 23, 2026");
  assert.equal(asSentence("Realized P/L: $0.00"), "Realized P/L: $0.00.");
  assert.equal(asSentence("Done."), "Done.");
  const state = createInitialState();
  const summary = summarizePortfolio(state, []);
  for (const q of ["How diversified am I?", "Discipline score", "How am I doing?", "biases"]) {
    for (const b of ruleBasedAnswer(q, { state, summary }).bullets ?? []) assert.match(b, /[.!?…:)]$/, b);
  }
});
