import assert from "node:assert/strict";
import { test } from "node:test";
import { marketStanding, marketStandingLabel, tradeOutcome, winRate, winRateHint } from "./benchmark";
import type { Transaction } from "./types";

const sellTx = (id: string, realizedGain: number): Transaction =>
  ({ id, type: "sell", symbol: "AAPL", shares: 1, price: 100, amount: 100, realizedGain, createdAt: "2026-11-01T00:00:00.000Z" }) as Transaction;

// Item 1: outperformance near zero reads "even", never "ahead".
test("marketStanding treats ~0 outperformance as even", () => {
  assert.equal(marketStanding(0), "even");
  assert.equal(marketStanding(0.004), "even");
  assert.equal(marketStanding(-0.04), "even");
  assert.equal(marketStanding(0.2), "ahead");
  assert.equal(marketStanding(-0.2), "behind");
  assert.equal(marketStandingLabel(0), "Even with the market");
  assert.equal(marketStandingLabel(1), "Ahead of the market");
  assert.equal(marketStandingLabel(-1), "Behind the market");
});

// Item 2: a $0.00 sell is break-even, not a loss.
test("winRate excludes break-even sells", () => {
  assert.equal(tradeOutcome(0), "breakeven");
  assert.equal(tradeOutcome(0.004), "breakeven");
  assert.equal(tradeOutcome(-0.004), "breakeven");
  assert.equal(tradeOutcome(0.01), "win");
  assert.equal(tradeOutcome(-0.01), "loss");

  const only = winRate([sellTx("a", 0)]);
  assert.equal(only.percent, null);
  assert.equal(only.closed, 0);
  assert.equal(only.breakeven, 1);
  assert.match(winRateHint(only), /1 break-even/);

  const mix = winRate([sellTx("a", 0), sellTx("b", 5), sellTx("c", -3)]);
  assert.equal(mix.wins, 1);
  assert.equal(mix.losses, 1);
  assert.equal(mix.closed, 2);
  assert.equal(mix.percent, 50);
  assert.equal(winRateHint(mix), "1 of 2 closed trades · 1 break-even");
});

// Item 3: one score, one name, one set of bands, and a "why it changed" line.
import { buildCoachContext } from "./coach-context";
import { DISCIPLINE_BANDS, disciplineBandsText, disciplineChangeWhy, disciplineLabel, disciplineScore, disciplineSnapshot, gradeFor } from "./discipline";
import { summarizePortfolio } from "./portfolio";
import { buy, createInitialState } from "./storage";

test("Discipline Score bands and label are shared", () => {
  assert.equal(gradeFor(71), "Strong");
  assert.equal(gradeFor(64), "Building");
  assert.equal(gradeFor(85), "Excellent");
  assert.equal(gradeFor(10), "Needs work");
  assert.equal(DISCIPLINE_BANDS.length, 4);
  assert.equal(disciplineBandsText(), "85+ Excellent, 70–84 Strong, 50–69 Building, under 50 Needs work");
  assert.equal(disciplineLabel({ score: 71, grade: "Strong" }), "Discipline Score 71/100 (Strong)");
});

test("coach context quotes the same Discipline Score as the dashboard", () => {
  const state = buy(createInitialState(), { symbol: "AAPL", shares: 5, price: 100 });
  const summary = summarizePortfolio(state, []);
  const now = Date.now();
  const d = disciplineScore(state, summary, now);
  const ctx = buildCoachContext({ state, summary, quotes: [], now });
  assert.ok(ctx.includes(`DISCIPLINE SCORE: ${d.score}/100 (${d.grade})`));
  assert.ok(ctx.includes('Call it "Discipline Score"'));
  // The experience level is never presented as a /100 score.
  assert.doesNotMatch(ctx.split("\n").find((l) => l.startsWith("Experience level")) ?? "", /\/100/);
});

test("disciplineChangeWhy explains the parts that moved", () => {
  const before = createInitialState();
  const s0 = disciplineScore(before, summarizePortfolio(before, []), 0);
  const after = buy(before, { symbol: "AAPL", shares: 100, price: 100 });
  const s1 = disciplineScore(after, summarizePortfolio(after, []), 0);
  const why = disciplineChangeWhy(disciplineSnapshot(s0), s1);
  assert.notEqual(s1.score, s0.score);
  assert.match(why ?? "", /^(Up|Down) \d+ since your last trade: /);
  assert.equal(disciplineChangeWhy(disciplineSnapshot(s1), s1), null);
});

// Item 4: safe markdown subset.
import { parseInline, parseMarkdown, stripMarkdown } from "./markdown";
import { followUpChips } from "./coach-followups";

test("parseInline handles bold, italic, code and leaves stray markers literal", () => {
  assert.deepEqual(parseInline("a **b** c"), [
    { t: "text", v: "a " },
    { t: "strong", c: [{ t: "text", v: "b" }] },
    { t: "text", v: " c" },
  ]);
  assert.deepEqual(parseInline("*hi*"), [{ t: "em", c: [{ t: "text", v: "hi" }] }]);
  assert.deepEqual(parseInline("`VTI`"), [{ t: "code", v: "VTI" }]);
  assert.deepEqual(parseInline("2 * 3 = 6"), [{ t: "text", v: "2 * 3 = 6" }]);
  assert.deepEqual(parseInline("snake_case_name"), [{ t: "text", v: "snake_case_name" }]);
  assert.deepEqual(parseInline("**unclosed"), [{ t: "text", v: "**unclosed" }]);
});

test("parseMarkdown builds paragraphs, lists and line breaks; HTML stays text", () => {
  const blocks = parseMarkdown("Intro line\nsecond line\n\n- one\n- **two**\n\n1. first\n2. second\n\n<script>x</script>");
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].t, "p");
  assert.ok(blocks[0].t === "p" && blocks[0].c.some((n) => n.t === "br"));
  assert.ok(blocks[1].t === "ul" && blocks[1].items.length === 2);
  assert.ok(blocks[2].t === "ol" && blocks[2].items.length === 2 && blocks[2].start === 1);
  assert.deepEqual(blocks[3], { t: "p", c: [{ t: "text", v: "<script>x</script>" }] });
  assert.equal(stripMarkdown("**Bold** and *it*\n- a\n- b"), "Bold and it a; b");
});

// Item 15: follow-up chips.
test("followUpChips gives generic chips plus a topical one within the length cap", () => {
  const chips = followUpChips("Your **Discipline Score** is 71/100. Write a thesis for VTI.");
  assert.deepEqual(chips.slice(0, 3).map((c) => c.label), ["Show me how", "What should I do next?", "Explain simpler"]);
  assert.equal(chips.length, 4);
  assert.ok(chips.every((c) => c.question.length <= 300));
  assert.ok(!chips[0].question.includes("**"));
});

// Items 6, 11, 17: nav visibility, search palette, shortcuts.
import { paletteResults, visibleNav } from "./nav";
import { resolveShortcut, SHORTCUT_HELP } from "./shortcuts";

test("Leagues is hidden from nav without accounts", () => {
  assert.ok(!visibleNav(false).some((p) => p.href === "/app/leagues"));
  assert.ok(visibleNav(true).some((p) => p.href === "/app/leagues"));
  assert.ok(!paletteResults("leag", false).some((r) => r.href === "/app/leagues"));
});

test("paletteResults finds tickers (to Trade) and pages", () => {
  const aapl = paletteResults("AAPL", false);
  assert.equal(aapl[0].kind, "ticker");
  assert.equal(aapl[0].href, "/app/trade?symbol=AAPL");
  const watch = paletteResults("watch", false);
  assert.equal(watch[0].href, "/app/watchlist");
  assert.ok(paletteResults("", false).length > 0);
});

test("G then W / G then C shortcuts and help entries", () => {
  const first = resolveShortcut({ key: "g" }, null, { pendingG: null }, 1000);
  assert.deepEqual(resolveShortcut({ key: "w" }, null, first.state, 1100).action, { kind: "nav", href: "/app/watchlist" });
  assert.deepEqual(resolveShortcut({ key: "c" }, null, first.state, 1100).action, { kind: "nav", href: "/app/coach" });
  assert.ok(SHORTCUT_HELP.some((h) => h.keys.join("") === "GW"));
  assert.ok(SHORTCUT_HELP.some((h) => h.keys.join("") === "GC"));
});

// Items 7, 10: copy fixes and Quick Start coach text.
import { inSentence } from "./format";
import { quickStartCoachText } from "./quick-start";

test("inSentence keeps acronyms", () => {
  assert.equal(inSentence("FOMO buy"), "FOMO buy");
  assert.equal(inSentence("Revenge trade"), "revenge trade");
  assert.equal(inSentence("Beat the S&P 500"), "beat the S&P 500");
});

test("quickStartCoachText cites the first trade, cash and goal", () => {
  const t = quickStartCoachText({ bought: { symbol: "AAPL", shares: 2, price: 250 }, cash: 24_500, total: 25_000, holdings: 1, goals: ["plan"] });
  assert.match(t, /You bought 2 AAPL at \$250\.00, about \$500\.00\./);
  assert.match(t, /2\.0% of your \$25,000\.00 account, with \$24,500\.00 still in cash/);
  assert.match(t, /Your goal is to trade with a plan\./);
  assert.match(t, /price alert on AAPL/);
  const none = quickStartCoachText({ bought: null, cash: 1000, total: 1000, holdings: 0, goals: [] });
  assert.match(none, /You have \$1,000\.00 in cash/);
});

// Item 12: sample starter portfolio.
import { dismissStarterNotice, freshStartCash, isStarterTx, showStarterNotice, startFresh } from "./storage";

test("starter portfolio notice, Starter labels and Start fresh", () => {
  const s0 = createInitialState();
  assert.equal(showStarterNotice(s0), true);
  assert.ok(s0.transactions.every(isStarterTx));
  const cash = freshStartCash(s0);
  assert.ok(cash > 40_000 && cash < 50_000);

  assert.equal(showStarterNotice(dismissStarterNotice(s0)), false);

  const fresh = startFresh({ ...s0, profileName: "Alex", watchlist: ["AAPL"] });
  assert.equal(fresh.cash, cash);
  assert.equal(fresh.holdings.length, 0);
  assert.equal(fresh.theses.length, 0);
  assert.equal(fresh.transactions.length, 1);
  assert.equal(fresh.transactions[0].type, "deposit");
  assert.equal(isStarterTx(fresh.transactions[0]), false);
  assert.equal(fresh.profileName, "Alex");
  assert.deepEqual(fresh.watchlist, ["AAPL"]);
  assert.equal(showStarterNotice(fresh), false);
  assert.throws(() => startFresh(s0, 0));

  // A user's own buy is never labeled Starter.
  const mine = buy(s0, { symbol: "AAPL", shares: 1, price: 100 });
  assert.equal(isStarterTx(mine.transactions.at(-1)!), false);
});

// Item 13: quick first badges and sensible "beat SPY" progress.
import { evaluateChallenges, firstBadgeHint, monthElapsed, newlyEarned } from "./challenges";
import { reviewTrade, sell } from "./storage";
import type { PerfSnapshot } from "./types";

const PLAN = { why: "Test", exit: "Sell at -10%", risk: 10 };

test("First Plan and First Look are earnable with one trade each", () => {
  let s = createInitialState();
  let p = evaluateChallenges(s, summarizePortfolio(s, []));
  assert.equal(p.find((x) => x.def.id === "first-plan")!.done, false);
  assert.match(firstBadgeHint(p).hint, /First Plan/);
  assert.equal(firstBadgeHint(p).href, "/app/trade");

  s = buy(s, { symbol: "AAPL", shares: 1, price: 100 }, "", { plan: PLAN });
  p = evaluateChallenges(s, summarizePortfolio(s, []));
  assert.deepEqual(newlyEarned(s, p), ["first-plan"]);
  assert.match(firstBadgeHint(p).hint, /First Look/);

  s = sell(s, { symbol: "AAPL", shares: 1, price: 100 });
  s = reviewTrade(s, s.transactions.at(-1)!.id, { rating: 3 });
  p = evaluateChallenges(s, summarizePortfolio(s, []));
  assert.deepEqual(newlyEarned(s, p).sort(), ["first-plan", "first-review"]);
});

test("beat-SPY progress is 0 while tied or behind, never a default 50%", () => {
  const now = new Date(2026, 10, 16, 12).getTime(); // mid-November
  const mk = (value: number, spy: number) => ({
    ...createInitialState(),
    createdAt: new Date(2026, 10, 1).toISOString(),
    snapshots: [
      { t: new Date(2026, 10, 2).toISOString(), value: 1000, spy: 100, flow: 0 },
      { t: new Date(2026, 10, 15).toISOString(), value, spy, flow: 0 },
    ] satisfies PerfSnapshot[],
  });
  const tied = evaluateChallenges(mk(1010, 101), null, now).find((x) => x.def.id === "beat-spy-month")!;
  assert.equal(tied.ratio, 0);
  assert.match(tied.detail, /even with SPY/);
  const behind = evaluateChallenges(mk(1000, 105), null, now).find((x) => x.def.id === "beat-spy-month")!;
  assert.equal(behind.ratio, 0);
  const ahead = evaluateChallenges(mk(1100, 101), null, now).find((x) => x.def.id === "beat-spy-month")!;
  assert.ok(ahead.ratio > 0.4 && ahead.ratio < 0.6);
  assert.equal(monthElapsed({ start: 0, end: 100 }, 25), 0.25);
});

// Item 14: alerts explanation on the Watchlist.
import { alertsHelp } from "./notify";

test("alertsHelp explains when alerts fire and how to enable them", () => {
  const def = alertsHelp({ permission: "default", iosHomeScreen: false, pushConfigured: false, enabled: false });
  assert.equal(def.canRequest, true);
  assert.match(def.body, /only while Sentia is open/);
  const blocked = alertsHelp({ permission: "denied", iosHomeScreen: false, pushConfigured: false, enabled: false });
  assert.equal(blocked.canRequest, false);
  assert.ok(blocked.steps.length >= 2);
  const ios = alertsHelp({ permission: "unsupported", iosHomeScreen: true, pushConfigured: false, enabled: false });
  assert.match(ios.title, /Home Screen/);
  assert.ok(ios.steps.some((s) => /Add to Home Screen/.test(s)));
  assert.equal(alertsHelp({ permission: "granted", iosHomeScreen: false, pushConfigured: false, enabled: true }).hidden, true);
  assert.match(alertsHelp({ permission: "default", iosHomeScreen: false, pushConfigured: true, enabled: false }).body, /even when Sentia is closed/);
});
