// v5: schema migration, pre-trade plans, post-trade reviews, weekly report cards,
// challenges/badges, ticker search, position sizer, CSV export, theme and Pages config.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { awardBadges, evaluateChallenges, heldSectors, newlyEarned, trackDips } from "./challenges";
import { csvCell, holdingsCsv, transactionsCsv } from "./csv";
import { positionSize } from "./position-size";
import { summarizePortfolio } from "./portfolio";
import { buildWeeklyReport, coachTip, dueReportWeek, gradeLetter, periodReturns, reportPrompt, upsertReport, weekKey, weekRange } from "./report-card";
import { buy, cleanPlan, createInitialState, importStateJson, migrateUnknown, reviewTrade, sell, setPracticeGoals } from "./storage";
import { parseSearchResponse, searchSymbols, SYMBOL_DIRECTORY } from "./symbols";
import { parseThemePref, resolveTheme, THEME_INIT_SCRIPT } from "./theme";
import { AppStateSchema, DEFAULT_SETTINGS, SCHEMA_VERSION, type AppState, type PerfSnapshot, type Quote, type WeeklyReport } from "./types";
import { pushPayloadAlerts, base64UrlToBytes } from "./push";

const q = (symbol: string, price: number): Quote => ({ symbol, price, previousClose: price, changePercent: 0, source: "demo" });
const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString();
const PLAN = { why: "Strong earnings", exit: "Sell below 180", risk: 50 };

function valid(s: AppState) {
  const parsed = AppStateSchema.safeParse(s);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)));
}

// ---- schema v5 + migration ----------------------------------------------------------

test("schema is v6 and a fresh workspace has the new defaults", () => {
  const s = createInitialState();
  assert.equal(SCHEMA_VERSION, 6);
  assert.deepEqual(s.settings, { ...DEFAULT_SETTINGS });
  assert.equal(s.settings.preTradeChecklist, true);
  assert.equal(s.settings.alertNotifications, false);
  assert.deepEqual(s.profile.goals, []);
  assert.deepEqual([s.reports, s.badges, s.dips], [[], [], []]);
  valid(s);
});

test("a saved v4 account upgrades cleanly to v6, keeping everything it had", () => {
  const fresh = createInitialState();
  const { reports, badges, dips, ...rest } = fresh;
  void reports;
  void badges;
  void dips;
  const v4 = JSON.parse(
    JSON.stringify({
      ...rest,
      version: 4,
      profile: { experience: "some", focus: "discipline", avatarColor: "#2563eb" },
      settings: { celebrations: false, haptics: true },
      leagues: ["K7Q2MX"],
    }),
  );
  const migrated = migrateUnknown(v4);
  assert.ok(migrated);
  assert.equal(migrated.version, 6);
  assert.deepEqual(migrated.settings, { celebrations: false, haptics: true, preTradeChecklist: true, alertNotifications: false });
  assert.deepEqual(migrated.profile, { experiences: ["some"], focuses: ["discipline"], avatarColor: "#2563eb", goals: [] });
  assert.deepEqual(migrated.leagues, ["K7Q2MX"]);
  assert.equal(migrated.transactions.length, fresh.transactions.length);
  assert.deepEqual([migrated.reports, migrated.badges, migrated.dips], [[], [], []]);
  // Same path as backup import and the Firestore loader.
  assert.equal(importStateJson(JSON.stringify(v4)).version, 6);
});

test("a v1 → v6 chain and garbage are both handled", () => {
  const v1 = { version: 1, cash: 10, holdings: [], theses: [], createdAt: iso(2025, 1, 1), updatedAt: iso(2025, 1, 1) };
  assert.equal(migrateUnknown(v1)?.version, 6);
  assert.equal(migrateUnknown({ version: 99 }), null);
  assert.equal(migrateUnknown("nope"), null);
});

// ---- pre-trade plan + post-trade review ------------------------------------------------

test("a buy saves its checklist answers; incomplete answers are not saved", () => {
  let s = buy(createInitialState(), { symbol: "AAPL", shares: 1.5, price: 200 }, "", { plan: PLAN });
  assert.deepEqual(s.transactions.at(-1)?.plan, PLAN);
  s = buy(s, { symbol: "AAPL", shares: 1, price: 200 }, "", { plan: { why: " ", exit: "x", risk: 1 } });
  assert.equal(s.transactions.at(-1)?.plan, undefined);
  assert.equal(cleanPlan({ why: "a".repeat(400), exit: "b", risk: 10.456 })?.why.length, 300);
  assert.equal(cleanPlan({ why: "a", exit: "b", risk: 10.456 })?.risk, 10.46);
  valid(s);
});

test("only sells can be reviewed; ratings are 1–5 and a re-review replaces the old one", () => {
  let s = buy(createInitialState(), { symbol: "AAPL", shares: 2, price: 100 });
  s = sell(s, { symbol: "AAPL", shares: 2, price: 110 });
  const sellTx = s.transactions.at(-1)!;
  const buyTx = s.transactions.at(-2)!;
  assert.throws(() => reviewTrade(s, buyTx.id, { rating: 4 }), /Only a completed sell/);
  assert.throws(() => reviewTrade(s, sellTx.id, { rating: 6 }), /1 to 5/);
  s = reviewTrade(s, sellTx.id, { rating: 4, lesson: "  Stuck to the plan  " });
  s = reviewTrade(s, sellTx.id, { rating: 5, lesson: "Even better" });
  const reviewed = s.transactions.find((t) => t.id === sellTx.id)!;
  assert.equal(reviewed.review?.rating, 5);
  assert.equal(reviewed.review?.lesson, "Even better");
  valid(s);
});

// ---- weekly report card ------------------------------------------------------------

test("weeks run Monday to Monday in local time", () => {
  assert.equal(weekKey(new Date(2026, 10, 23, 9)), "2026-11-23"); // Monday
  assert.equal(weekKey(new Date(2026, 10, 29, 23)), "2026-11-23"); // Sunday night
  assert.equal(weekKey(new Date(2026, 10, 30, 0, 1)), "2026-11-30");
  const r = weekRange("2026-11-23");
  assert.equal(new Date(r.end).getDate(), 30);
});

test("periodReturns is time-weighted (deposits aren't gains) and compares with SPY", () => {
  const snaps: PerfSnapshot[] = [
    { t: iso(2026, 11, 13), value: 1000, spy: 100, flow: 0 },
    { t: iso(2026, 11, 17), value: 1100, spy: 101, flow: 0 },
    { t: iso(2026, 11, 19), value: 2200, spy: 102, flow: 1000 }, // +1000 deposit, +100 gain
  ];
  const { start, end } = weekRange("2026-11-16");
  const r = periodReturns(snaps, start, end);
  assert.ok(r);
  assert.equal(r.spyReturnPct, 2);
  assert.equal(r.returnPct, 20); // 1000→1100 (+10%), 1100→1200 ex-flow (+9.09%) ≈ +20%
  assert.equal(periodReturns(snaps.slice(0, 1), start, end), null);
});

test("buildWeeklyReport grades process + results, finds best/worst and writes a tip", () => {
  let s = createInitialState();
  s = { ...s, createdAt: iso(2026, 11, 1) };
  // Trades during the week of Nov 16.
  const at = (d: number, st: AppState) => ({ ...st, transactions: st.transactions.map((t, i, all) => (i === all.length - 1 ? { ...t, createdAt: iso(2026, 11, d) } : t)) });
  s = at(16, buy(s, { symbol: "AAPL", shares: 10, price: 100 }, "", { plan: PLAN }));
  s = at(17, buy(s, { symbol: "MSFT", shares: 5, price: 400 }));
  s = at(18, sell(s, { symbol: "AAPL", shares: 10, price: 120 }));
  s = at(19, sell(s, { symbol: "MSFT", shares: 5, price: 380 }));
  s = {
    ...s,
    snapshots: [
      { t: iso(2026, 11, 13), value: 1000, spy: 100, flow: 0 },
      { t: iso(2026, 11, 20), value: 1050, spy: 101, flow: 0 },
    ],
  };
  const r = buildWeeklyReport(s, "2026-11-16");
  assert.equal(r.trades, 4);
  assert.deepEqual(r.best, { symbol: "AAPL", gain: 200, gainPct: 20 });
  assert.deepEqual(r.worst, { symbol: "MSFT", gain: -100, gainPct: -5 });
  assert.equal(r.returnPct, 5);
  assert.equal(r.spyReturnPct, 1);
  // plan 1/2 → 12.5, reviews 0/2 → 0, biases 20, results 20+16=36 → 68.5 → 69 (D)
  assert.equal(r.score, 69);
  assert.equal(r.grade, "D");
  assert.ok(r.notes.some((n) => /1 of 2 buys had a written plan/.test(n)));
  assert.ok(r.notes.some((n) => /Ahead of the S&P 500 by 4\.00/.test(n)));
  assert.match(r.tip, /checklist/);
  assert.ok(reportPrompt({ ...r }).length <= 300);
});

test("a quiet week still gets a fair report, and grades map to letters", () => {
  const s = { ...createInitialState(), createdAt: iso(2026, 11, 1) };
  const r = buildWeeklyReport(s, "2026-11-16");
  assert.equal(r.trades, 0);
  assert.equal(r.best, null);
  assert.equal(r.returnPct, null);
  assert.ok(r.notes[0].startsWith("No trades this week"));
  assert.deepEqual([95, 85, 75, 65, 10].map(gradeLetter), ["A", "B", "C", "D", "F"]);
  assert.match(coachTip({ buys: 0, planned: 0, sells: 0, reviewed: 0, biases: ["fomo"], perf: null, trades: 3, goals: [] }), /^Next week:/);
});

test("the report for last week is due on Monday, once, and only for accounts that existed then", () => {
  const monday = new Date(2026, 10, 23, 9).getTime();
  const s = { ...createInitialState(), createdAt: iso(2026, 11, 1) };
  assert.equal(dueReportWeek(s, monday), "2026-11-16");
  const report: WeeklyReport = { ...buildWeeklyReport(s, "2026-11-16"), createdAt: iso(2026, 11, 23) };
  assert.equal(dueReportWeek({ ...s, reports: [report] }, monday), null);
  assert.equal(dueReportWeek({ ...s, createdAt: iso(2026, 11, 23, 8) }, monday), null);
  const list = upsertReport(upsertReport([], { ...report, week: "2026-11-09" }), report);
  assert.deepEqual(list.map((r) => r.week), ["2026-11-16", "2026-11-09"]);
  valid({ ...s, reports: list });
});

// ---- challenges & badges ---------------------------------------------------------------

test("5 planned buys, 3 reviews and 3 stock sectors complete their challenges", () => {
  let s = createInitialState();
  for (const sym of ["AAPL", "JPM", "XOM", "KO", "MSFT"]) s = buy(s, { symbol: sym, shares: 1, price: 100 }, "", { plan: PLAN });
  for (const sym of ["KO", "MSFT", "XOM"]) s = sell(s, { symbol: sym, shares: 1, price: 101 });
  for (const t of s.transactions.filter((x) => x.type === "sell")) s = reviewTrade(s, t.id, { rating: 3 });
  const summary = summarizePortfolio(s, []);
  const progress = evaluateChallenges(s, summary, Date.now());
  const byId = Object.fromEntries(progress.map((p) => [p.def.id, p]));
  assert.equal(byId["planned-trades"].done, true);
  assert.equal(byId["review-trades"].done, true);
  assert.deepEqual(heldSectors(["AAPL", "JPM", "VTI", "BND", "ZZZZ"]).sort(), ["Financials", "Technology"]);
  assert.equal(byId["three-sectors"].done, false); // AAPL + JPM left (VTI/VXUS/BND don't count)
  const ids = newlyEarned(s, progress);
  assert.deepEqual(ids.sort(), ["planned-trades", "review-trades"]);
  s = awardBadges(s, ids);
  assert.deepEqual(newlyEarned(s, evaluateChallenges(s, summary)), []);
  assert.equal(awardBadges(s, ids), s); // idempotent
  valid(s);
});

test("beating SPY last month earns that month's badge", () => {
  const now = new Date(2026, 10, 10, 12).getTime(); // Nov 10
  const s = {
    ...createInitialState(),
    createdAt: iso(2026, 9, 20),
    snapshots: [
      { t: iso(2026, 9, 30), value: 1000, spy: 100, flow: 0 },
      { t: iso(2026, 10, 31, 10), value: 1080, spy: 103, flow: 0 },
      { t: iso(2026, 11, 9), value: 1080, spy: 104, flow: 0 },
    ] satisfies PerfSnapshot[],
  };
  const p = evaluateChallenges(s, null, now).find((x) => x.def.id === "beat-spy-month")!;
  assert.equal(p.done, true);
  assert.equal(p.badgeId, "beat-spy-month:2026-10");
  assert.match(p.detail, /behind/);
  valid(awardBadges(s, [p.badgeId]));
});

test("holding through a 5% dip back to cost earns Steady Hands; selling clears the watch", () => {
  let s = buy(createInitialState(), { symbol: "AAPL", shares: 10, price: 100 });
  let r = trackDips(s, [q("AAPL", 97)]);
  assert.equal(r.state, s); // −3%: nothing to watch
  r = trackDips(s, [q("AAPL", 94)]);
  assert.equal(r.state.dips.length, 1);
  assert.equal(r.state.dips[0].dipPct, -6);
  s = r.state;
  r = trackDips(s, [q("AAPL", 90)]);
  assert.equal(r.state.dips[0].dipPct, -10);
  r = trackDips(r.state, [q("AAPL", 100.5)]);
  assert.equal(r.earned, true);
  assert.equal(r.state.dips.length, 0);
  assert.ok(r.state.badges.some((b) => b.id === "hold-dip"));
  valid(r.state);
  // Sold while dipping: the watch is dropped, no badge.
  let t = trackDips(buy(createInitialState(), { symbol: "NVDA", shares: 1, price: 100 }), [q("NVDA", 90)]).state;
  t = sell(t, { symbol: "NVDA", shares: 1, price: 90 });
  const after = trackDips(t, [q("NVDA", 110)]);
  assert.equal(after.earned, false);
  assert.equal(after.state.dips.length, 0);
});

test("the practice goal is saved on the profile", () => {
  const s = setPracticeGoals(createInitialState(), ["diversify"]);
  assert.deepEqual(s.profile.goals, ["diversify"]);
  valid(s);
});

// ---- ticker search ----------------------------------------------------------------------

test("ticker search ranks exact, prefix and company-name matches", () => {
  assert.equal(searchSymbols("aapl")[0].symbol, "AAPL");
  assert.equal(searchSymbols("apple")[0].symbol, "AAPL");
  assert.ok(searchSymbols("micro").some((e) => e.symbol === "MSFT"));
  assert.ok(searchSymbols("v", 3).every((e) => e.symbol.startsWith("V")));
  assert.deepEqual(searchSymbols("  "), []);
  assert.equal(searchSymbols("zzzq9", 5, [{ symbol: "ZZZQ", name: "Zed" }]).length, 0);
  assert.equal(searchSymbols("zed", 5, [{ symbol: "ZZZQ", name: "Zed Corp" }])[0].symbol, "ZZZQ");
  assert.ok(SYMBOL_DIRECTORY.length > 100);
  assert.equal(new Set(SYMBOL_DIRECTORY.map((e) => e.symbol)).size, SYMBOL_DIRECTORY.length);
  assert.deepEqual(parseSearchResponse({ results: [{ symbol: "msft", name: "Microsoft" }, { symbol: "<x>" }, 5] }), [{ symbol: "MSFT", name: "Microsoft" }]);
  assert.deepEqual(parseSearchResponse(null), []);
});

// ---- position sizer ---------------------------------------------------------------------

test("position sizer: shares = account × risk% ÷ (entry − stop), fractional, rounded down", () => {
  const r = positionSize({ account: 10_000, riskPct: 1, entry: 50, stop: 47 });
  assert.ok(r.ok);
  assert.equal(r.riskAmount, 100);
  assert.equal(r.shares, 33.3333);
  assert.equal(r.cost, 1666.67);
  assert.ok(r.shares * 3 <= 100);
  const big = positionSize({ account: 10_000, riskPct: 2, entry: 100, stop: 99, cash: 5000 });
  assert.ok(big.ok && big.exceedsCash && big.affordableShares === 50);
  assert.equal(positionSize({ account: 1000, riskPct: 1, entry: 50, stop: 55 }).ok, false);
  assert.equal(positionSize({ account: 0, riskPct: 1, entry: 50, stop: 45 }).ok, false);
  assert.equal(positionSize({ account: 1000, riskPct: 150, entry: 50, stop: 45 }).ok, false);
});

// ---- CSV -------------------------------------------------------------------------------

test("CSV export quotes properly and neutralises spreadsheet formulas", () => {
  assert.equal(csvCell('He said "hi", ok'), '"He said ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(1)", true), "'=HYPERLINK(1)");
  assert.equal(csvCell(-5, true), "-5"); // numbers are never prefixed
  assert.equal(csvCell(null), "");
  let s = buy(createInitialState(), { symbol: "AAPL", shares: 1, price: 200 }, "", { plan: { why: "=cmd|calc", exit: "line1\nline2", risk: 20 } });
  s = sell(s, { symbol: "AAPL", shares: 1, price: 210 });
  s = reviewTrade(s, s.transactions.at(-1)!.id, { rating: 4, lesson: "ok" });
  const csv = transactionsCsv(s);
  const lines = csv.split("\r\n");
  assert.ok(lines[0].startsWith("date,type,symbol,shares,price,amount,realized_gain"));
  assert.ok(csv.includes("'=cmd|calc"));
  assert.ok(csv.includes('"line1\nline2"'));
  assert.ok(lines.some((l) => l.includes(",sell,AAPL,1,210,210,10,") && l.includes(",4,ok,")));
  const h = holdingsCsv(summarizePortfolio(s, [q("VTI", 250)]));
  assert.ok(h.split("\r\n")[0].startsWith("symbol,name,shares"));
  assert.ok(h.includes("CASH,Cash"));
  assert.ok(h.includes("VTI,Vanguard Total Stock Market ETF,42,245.5,250,10500"));
});

// ---- theme, push helpers, Pages config, service worker -------------------------------------

test("theme preference defaults to dark and 'system' follows the OS", () => {
  assert.equal(parseThemePref(null), "dark");
  assert.equal(parseThemePref("weird"), "dark");
  assert.equal(resolveTheme("system", true), "light");
  assert.equal(resolveTheme("system", false), "dark");
  assert.equal(resolveTheme("light", false), "light");
  // The pre-paint script must run standalone and set data-theme.
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  vm.runInNewContext(THEME_INIT_SCRIPT, {
    localStorage: { getItem: () => "light" },
    window: { matchMedia: () => ({ matches: false }) },
    document: { documentElement: root, querySelector: () => null },
  });
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.style.colorScheme, "light");
});

test("background push sends only active alerts and decodes the VAPID key", () => {
  const s = createInitialState();
  const alerts = [
    { id: "11111111-2222-4333-8444-555555555555", symbol: "AAPL", direction: "above" as const, price: 200, status: "active" as const, createdAt: iso(2026, 11, 1) },
    { id: "11111111-2222-4333-8444-555555555556", symbol: "MSFT", direction: "below" as const, price: 300, status: "triggered" as const, createdAt: iso(2026, 11, 1) },
  ];
  assert.deepEqual(pushPayloadAlerts({ ...s, alerts }.alerts), [{ id: alerts[0].id, symbol: "AAPL", direction: "above", price: 200 }]);
  assert.deepEqual([...base64UrlToBytes("AQID_-8")], [1, 2, 3, 255, 239]);
});

test("Pages site config: custom domain → root base path + CNAME, else /<repo>", async () => {
  const { resolvePagesSite, normalizeDomain } = (await import(path.join(process.cwd(), "scripts", "pages-site.mjs"))) as {
    resolvePagesSite: (i: Record<string, string | undefined>) => { domain: string; basePath: string; siteUrl: string };
    normalizeDomain: (v: string) => string;
  };
  assert.deepEqual(resolvePagesSite({ customDomain: "https://Sentia.Example.com/", pagesBasePath: "/SentiaPTCoach" }), {
    domain: "sentia.example.com",
    basePath: "",
    siteUrl: "https://sentia.example.com",
  });
  assert.deepEqual(resolvePagesSite({ customDomain: "", pagesBasePath: "", repo: "SentiaPTCoach" }), { domain: "", basePath: "/SentiaPTCoach", siteUrl: "" });
  assert.equal(normalizeDomain("not a domain"), "");
  assert.equal(normalizeDomain("someone.github.io"), "");
  assert.equal(normalizeDomain("app.sentia.co"), "app.sentia.co");
  const wf = readFileSync(path.join(process.cwd(), ".github", "workflows", "deploy-pages.yml"), "utf8");
  assert.match(wf, /vars\.PAGES_CUSTOM_DOMAIN/);
  assert.match(wf, /out\/CNAME/);
  assert.match(wf, /NEXT_PUBLIC_FIREBASE_PROJECT_ID: \$\{\{ vars\.NEXT_PUBLIC_FIREBASE_PROJECT_ID \}\}/);
  assert.match(wf, /branches:\s*\n\s*- main/);
});

test("service worker builds safe push notifications (same-origin links only)", () => {
  const code = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  const sandbox = { module: { exports: {} as { pushNotice?: (d: unknown, s: string) => { title: string; options: { body: string; data: { url: string } } } } }, self: { location: { href: "https://x.test/app/sw.js" }, addEventListener: () => undefined }, URL };
  vm.runInNewContext(code, sandbox);
  const pushNotice = sandbox.module.exports.pushNotice!;
  const scope = "https://x.test/SentiaPTCoach/";
  const n = pushNotice({ title: "Price alert", body: "AAPL rose", url: "app/trade/?symbol=AAPL" }, scope);
  assert.equal(n.title, "Price alert");
  assert.equal(n.options.data.url, "https://x.test/SentiaPTCoach/app/trade/?symbol=AAPL");
  assert.equal(pushNotice({ url: "https://evil.example/x" }, scope).options.data.url, "https://x.test/SentiaPTCoach/app/");
  assert.equal(pushNotice(null, scope).title, "Sentia price alert");
});
