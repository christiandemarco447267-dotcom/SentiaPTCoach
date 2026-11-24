import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInsights } from "./insights";
import { summarizePortfolio } from "./portfolio";
import { buy, createInitialState } from "./storage";

test("buildInsights flags unlinked holdings in thesis coverage", () => {
  // Seeded holdings all ship with a linked thesis, so add a bare one to flag.
  const state = buy(createInitialState(), { symbol: "AAPL", shares: 1, price: 100 });
  const summary = summarizePortfolio(state, []);
  const insights = buildInsights(state, summary);
  const coverage = insights.find((i) => i.id === "thesis-coverage");
  assert.ok(coverage);
  assert.equal(coverage?.tone, "watch");
  assert.match(coverage?.body ?? "", /\(AAPL\) lacks a linked thesis/);
});

test("buildInsights reports full thesis coverage when every holding is linked", () => {
  const state = createInitialState();
  const summary = summarizePortfolio(state, []);
  const coverage = buildInsights(state, summary).find((i) => i.id === "thesis-coverage");
  assert.ok(coverage);
  assert.equal(coverage?.tone, "good");
});

test("buildInsights includes diversification, concentration, and cash cards", () => {
  const state = createInitialState();
  const summary = summarizePortfolio(state, []);
  const ids = buildInsights(state, summary).map((i) => i.id);
  assert.ok(ids.includes("diversification"));
  assert.ok(ids.includes("concentration"));
  assert.ok(ids.includes("cash"));
});

test("buildInsights prompts to start when there are no holdings", () => {
  const base = createInitialState();
  const state = { ...base, holdings: [] };
  const summary = summarizePortfolio(state, []);
  const insights = buildInsights(state, summary);
  assert.ok(insights.some((i) => i.id === "start"));
});

test("concentration and sizing state their basis so the two numbers agree", async () => {
  const { disciplineScore } = await import("./discipline");
  // Mostly cash, one big position: % of invested money differs from % of the total account.
  const base = createInitialState();
  const state = buy({ ...base, holdings: [], transactions: [], cash: 10_000 }, { symbol: "VTI", shares: 20, price: 100 });
  const withVxus = buy(state, { symbol: "VXUS", shares: 10, price: 100 });
  const summary = summarizePortfolio(withVxus, []);
  const vti = summary.holdings.find((h) => h.symbol === "VTI");
  assert.ok(vti && summary.holdings[0].symbol === "VTI");
  const ofInvested = Math.round((vti.marketValue / summary.investments) * 100);
  const ofTotal = Math.round((vti.marketValue / summary.total) * 100);
  assert.notEqual(ofInvested, ofTotal);
  const body = buildInsights(withVxus, summary).find((i) => i.id === "concentration")?.body ?? "";
  assert.match(body, new RegExp(`${ofInvested}% of your invested money \\(${ofTotal}% of your total portfolio, including cash\\)`));
  const sizing = disciplineScore(withVxus, summary).parts.find((p) => p.key === "sizing")?.detail ?? "";
  assert.match(sizing, new RegExp(`VTI at ${ofTotal}% of your total portfolio \\(including cash\\)`));
});
