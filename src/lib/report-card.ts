// Weekly report card (pure; unit-tested). Each Monday the week that just ended
// (Mon 00:00 → next Mon 00:00, device-local time) gets a grade, its best and worst
// closed trade, return vs the S&P 500 (SPY), discipline notes and one coach tip.
// The tip comes from the built-in rule-based coach; the store may later swap in an
// AI coach tip (tipSource "ai") when the Sentia API is configured.
import { benchmarkSeries, feedSegment } from "./benchmark";
import { BIAS_INFO, detectBiasEvents, isDecisionTrade, type BiasKey } from "./biases";
import { localDayKey } from "./market";
import { round2 } from "./portfolio";
import type { AppState, PerfSnapshot, ReportTrade, Transaction, WeeklyReport } from "./types";
import { LIMITS } from "./validation";

const DAY = 86_400_000;
const ms = (iso: string) => new Date(iso).getTime();

/** Local midnight of the Monday on or before `t`. */
export function weekStart(t: number | Date): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - back);
  return d;
}

/** "YYYY-MM-DD" of the week's Monday. */
export function weekKey(t: number | Date): string {
  return localDayKey(weekStart(t));
}

/** Start (inclusive) and end (exclusive) of the week with this key, as epoch ms. */
export function weekRange(key: string): { start: number; end: number } {
  const [y, m, d] = key.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 7, 0, 0, 0, 0); // DST-safe: calendar days, not 7×24h
  return { start: start.getTime(), end: end.getTime() };
}

/** "Nov 16 – 22" style label for a week key. */
export function weekLabel(key: string): string {
  const { start, end } = weekRange(key);
  const a = new Date(start);
  const b = new Date(end - DAY / 2);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  return a.getMonth() === b.getMonth()
    ? `${month(a)} ${a.getDate()} – ${b.getDate()}`
    : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

/**
 * Time-weighted portfolio return and SPY return between two moments, from the
 * saved snapshots of the current price feed. Uses the last snapshot at/before the
 * start (else the first one inside the window) through the last one before the end.
 * Null when fewer than two snapshots cover the window.
 */
export function periodReturns(allSnapshots: PerfSnapshot[], start: number, end: number): { returnPct: number; spyReturnPct: number } | null {
  const snapshots = feedSegment(allSnapshots);
  let first = -1;
  for (let i = 0; i < snapshots.length; i += 1) {
    const t = ms(snapshots[i].t);
    if (t <= start) first = i;
    else break;
  }
  if (first < 0) first = snapshots.findIndex((s) => ms(s.t) > start && ms(s.t) < end);
  if (first < 0) return null;
  const window = snapshots.slice(first).filter((s) => ms(s.t) < end);
  if (window.length < 2) return null;
  const series = benchmarkSeries(window);
  const last = series[series.length - 1];
  return { returnPct: round2(last.portfolio - 100), spyReturnPct: round2(last.spy - 100) };
}

function tradeResult(tx: Transaction): ReportTrade {
  const gain = round2(tx.realizedGain ?? 0);
  const cost = tx.amount - gain;
  return { symbol: tx.symbol ?? "?", gain, gainPct: cost > 0 ? round2((gain / cost) * 100) : null };
}

export function gradeLetter(score: number): WeeklyReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export type ReportDraft = Omit<WeeklyReport, "createdAt" | "tipSource"> & { tipSource: "coach" };

/** Build the report for the week with this key from the account as it is now. */
export function buildWeeklyReport(state: AppState, key: string): ReportDraft {
  const { start, end } = weekRange(key);
  const inWeek = (tx: Transaction) => {
    const t = ms(tx.createdAt);
    return t >= start && t < end;
  };
  const trades = state.transactions.filter((tx) => isDecisionTrade(tx) && inWeek(tx));
  const buys = trades.filter((tx) => tx.type === "buy");
  const sells = trades.filter((tx) => tx.type === "sell" && tx.realizedGain !== undefined);
  const planned = buys.filter((tx) => tx.plan).length;
  const reviewed = sells.filter((tx) => tx.review).length;
  const biases = detectBiasEvents(state.transactions).filter((e) => {
    const t = ms(e.at);
    return t >= start && t < end;
  });
  const perf = periodReturns(state.snapshots, start, end);

  // ---- Score: 60 points of process, 40 of results vs the S&P 500 ----
  const planPts = buys.length ? (planned / buys.length) * 25 : 25;
  const reviewPts = sells.length ? (reviewed / sells.length) * 15 : 15;
  const biasPts = Math.max(0, 20 - biases.length * 7);
  const tradeCountPenalty = trades.length > 15 ? Math.min(10, trades.length - 15) : 0;
  const resultPts = perf ? 20 + Math.max(-20, Math.min(20, (perf.returnPct - perf.spyReturnPct) * 4)) : 20;
  const score = Math.max(0, Math.min(100, Math.round(planPts + reviewPts + biasPts + resultPts - tradeCountPenalty)));

  // ---- Best / worst closed trade ----
  const ranked = [...sells].sort((a, b) => (b.realizedGain ?? 0) - (a.realizedGain ?? 0));
  const best = ranked.length ? tradeResult(ranked[0]) : null;
  const worst = ranked.length > 1 ? tradeResult(ranked[ranked.length - 1]) : null;

  // ---- Discipline notes ----
  const notes: string[] = [];
  if (trades.length === 0) notes.push("No trades this week. Sitting still is a valid decision when nothing fits your plan.");
  if (buys.length) notes.push(`${planned} of ${buys.length} buy${buys.length === 1 ? "" : "s"} had a written plan (why, exit, risk).`);
  if (sells.length) notes.push(`${reviewed} of ${sells.length} closed trade${sells.length === 1 ? "" : "s"} reviewed with a lesson.`);
  const biasCounts = new Map<BiasKey, number>();
  for (const e of biases) biasCounts.set(e.bias, (biasCounts.get(e.bias) ?? 0) + 1);
  if (biases.length === 0 && trades.length) notes.push("No bias flags: no FOMO, revenge or panic patterns spotted.");
  for (const [bias, n] of biasCounts) notes.push(`${n} possible ${BIAS_INFO[bias].label.toLowerCase()} trade${n === 1 ? "" : "s"} flagged.`);
  if (trades.length > 15) notes.push(`${trades.length} trades is a lot for one week. Fewer, better-planned trades usually win.`);
  if (perf) {
    const diff = round2(perf.returnPct - perf.spyReturnPct);
    notes.push(
      diff >= 0
        ? `Ahead of the S&P 500 by ${diff.toFixed(2)} points this week.`
        : `Behind the S&P 500 by ${Math.abs(diff).toFixed(2)} points this week.`,
    );
  } else {
    notes.push("Not enough price history this week to compare with the S&P 500. Open Sentia a few times a week to record it.");
  }

  return {
    week: key,
    grade: gradeLetter(score),
    score,
    returnPct: perf?.returnPct ?? null,
    spyReturnPct: perf?.spyReturnPct ?? null,
    trades: trades.length,
    best,
    worst,
    notes: notes.slice(0, 6).map((n) => n.slice(0, 240)),
    tip: coachTip({ buys: buys.length, planned, sells: sells.length, reviewed, biases: [...biasCounts.keys()], perf, trades: trades.length, goal: state.profile.goal }),
    tipSource: "coach",
  };
}

type TipInput = {
  buys: number;
  planned: number;
  sells: number;
  reviewed: number;
  biases: BiasKey[];
  perf: { returnPct: number; spyReturnPct: number } | null;
  trades: number;
  goal: AppState["profile"]["goal"];
};

/** The built-in coach's one tip for next week: the weakest habit first. */
export function coachTip(t: TipInput): string {
  if (t.biases.length) return `Next week: ${BIAS_INFO[t.biases[0]].tip}`;
  if (t.buys > t.planned) return "Next week: before every buy, answer the three checklist questions (why, exit plan, risk). Writing the exit down first is what keeps a plan honest.";
  if (t.sells > t.reviewed) return "Next week: review each closed trade within a day. One sentence on what you'd repeat or avoid compounds faster than any single win.";
  if (t.trades > 15) return "Next week: try a cap of five trades. Fewer decisions leave more time to think each one through.";
  if (t.perf && t.perf.returnPct < t.perf.spyReturnPct) return "Next week: compare each idea with simply holding an index fund. If you can't say why it should beat SPY, practise with a smaller size.";
  if (t.trades === 0 && t.goal !== "learn") return "Next week: pick one idea from your watchlist and write a short thesis before you trade it, even if you end up not buying.";
  switch (t.goal) {
    case "diversify":
      return "Next week: check your sector mix on the Allocation page and see whether one area now dominates.";
    case "beat-market":
      return "Next week: keep tracking yourself against the S&P 500 and note which decisions moved the gap.";
    case "learn":
      return "Next week: ask Sentia to explain one term you met this week, such as cost basis or a stop order.";
    default:
      return "Next week: keep doing what worked. Plan before you buy, review after you sell, and size each trade so one loss can't hurt much.";
  }
}

/** The most recent completed week that has no report yet (null when it already exists or the account is newer than that week). */
export function dueReportWeek(state: AppState, now: number): string | null {
  const thisWeek = weekStart(now);
  const prev = new Date(thisWeek);
  prev.setDate(prev.getDate() - 7);
  const key = localDayKey(prev);
  if (state.reports.some((r) => r.week === key)) return null;
  // Only when the account existed before that week ended.
  if (ms(state.createdAt) >= thisWeek.getTime()) return null;
  return key;
}

/** Add (or replace) a report, newest first, keeping the last 52. */
export function upsertReport(reports: WeeklyReport[], report: WeeklyReport): WeeklyReport[] {
  const rest = reports.filter((r) => r.week !== report.week);
  return [report, ...rest].sort((a, b) => (a.week < b.week ? 1 : -1)).slice(0, LIMITS.maxReports);
}

/** Compact text the AI coach gets (alongside the account summary) to write the tip. */
export function reportPrompt(r: Pick<WeeklyReport, "grade" | "score" | "returnPct" | "spyReturnPct" | "trades" | "notes">): string {
  const ret = r.returnPct === null ? "not available" : `${r.returnPct.toFixed(2)}%`;
  const spy = r.spyReturnPct === null ? "not available" : `${r.spyReturnPct.toFixed(2)}%`;
  return [
    `Write ONE short coaching tip (max 2 sentences) for my next week of paper trading, based on my weekly report card.`,
    `Grade ${r.grade} (${r.score}/100). Trades: ${r.trades}. My return ${ret}, S&P 500 (SPY) ${spy}.`,
    `Notes: ${r.notes.join(" ")}`,
  ]
    .join(" ")
    .slice(0, 290);
}
