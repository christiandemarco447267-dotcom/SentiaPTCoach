// Challenges and badges (pure; unit-tested). Progress is computed from the account;
// a badge is recorded once a challenge is complete. "Beat the S&P this month" can be
// earned once per calendar month (badge id "beat-spy-month:YYYY-MM").
import { isDecisionTrade } from "./biases";
import { localDayKey } from "./market";
import { quoteMap, round2, type PortfolioSummary } from "./portfolio";
import { periodReturns } from "./report-card";
import { BROAD_FUND_SECTORS, sectorOf, type Sector } from "./sectors";
import { commit, nowIso } from "./storage";
import type { AppState, Badge, DipWatch, PracticeGoal, Quote } from "./types";
import { LIMITS, normalizeSymbol } from "./validation";

export type ChallengeId = "beat-spy-month" | "planned-trades" | "hold-dip" | "three-sectors" | "review-trades";

export type ChallengeDef = {
  id: ChallengeId;
  title: string;
  description: string;
  badge: string;
  /** The practice goal this challenge serves best (featured first for that goal). */
  goal: PracticeGoal;
};

export const CHALLENGES: ChallengeDef[] = [
  {
    id: "beat-spy-month",
    title: "Beat the S&P this month",
    description: "Finish a calendar month with a higher time-weighted return than SPY. Earned once the month ends; you can win it every month.",
    badge: "Index Beater",
    goal: "beat-market",
  },
  {
    id: "planned-trades",
    title: "5 trades with a plan",
    description: "Answer the pre-trade checklist (why, exit plan, risk) on five buys.",
    badge: "Planner",
    goal: "plan",
  },
  {
    id: "hold-dip",
    title: "Hold through a dip",
    description: "Keep a position that fell 5% or more below your cost until it climbs back to break-even, without selling it in between.",
    badge: "Steady Hands",
    goal: "learn",
  },
  {
    id: "three-sectors",
    title: "Diversify across 3 sectors",
    description: "Hold individual stocks or sector funds in at least three different sectors at once (broad index and bond funds don't count).",
    badge: "Diversifier",
    goal: "diversify",
  },
  {
    id: "review-trades",
    title: "Review 3 closed trades",
    description: "After selling, rate the trade and write one lesson. Do it three times.",
    badge: "Reflector",
    goal: "plan",
  },
];

export type ChallengeProgress = {
  def: ChallengeDef;
  current: number;
  target: number;
  /** 0–1 for the progress bar. */
  ratio: number;
  done: boolean;
  /** Badge id that would be (or was) awarded. */
  badgeId: string;
  earned: Badge[];
  detail: string;
};

const DAY = 86_400_000;
const ms = (iso: string) => new Date(iso).getTime();
export const DIP_THRESHOLD_PCT = -5;

function monthKey(d: Date): string {
  return localDayKey(d).slice(0, 7);
}

function monthRange(year: number, month: number): { start: number; end: number } {
  return { start: new Date(year, month, 1).getTime(), end: new Date(year, month + 1, 1).getTime() };
}

/** Distinct sectors held (excluding broad funds and unknown "Other"). */
export function heldSectors(symbols: string[]): Sector[] {
  const out = new Set<Sector>();
  for (const s of symbols) {
    const sector = sectorOf(s);
    if (sector === "Other" || BROAD_FUND_SECTORS.includes(sector)) continue;
    out.add(sector);
  }
  return [...out];
}

export function evaluateChallenges(state: AppState, summary: PortfolioSummary | null, now: number = Date.now()): ChallengeProgress[] {
  const badges = state.badges;
  const earnedFor = (id: ChallengeId) => badges.filter((b) => b.id === id || b.id.startsWith(`${id}:`));
  const trades = state.transactions.filter(isDecisionTrade);

  return CHALLENGES.map((def): ChallengeProgress => {
    const earned = earnedFor(def.id);
    const base = (current: number, target: number, done: boolean, detail: string, badgeId: string = def.id): ChallengeProgress => ({
      def,
      current,
      target,
      ratio: target > 0 ? Math.max(0, Math.min(1, current / target)) : done ? 1 : 0,
      done,
      badgeId,
      earned,
      detail,
    });

    switch (def.id) {
      case "planned-trades": {
        const n = trades.filter((t) => t.type === "buy" && t.plan).length;
        return base(Math.min(n, 5), 5, n >= 5, n >= 5 ? "Five planned buys. Planning is now a habit." : `${n} of 5 buys had a plan.`);
      }
      case "review-trades": {
        const n = trades.filter((t) => t.type === "sell" && t.review).length;
        return base(Math.min(n, 3), 3, n >= 3, n >= 3 ? "Three trades reviewed." : `${n} of 3 closed trades reviewed.`);
      }
      case "three-sectors": {
        const symbols = (summary?.holdings ?? state.holdings).filter((h) => h.shares > 0).map((h) => h.symbol);
        const sectors = heldSectors(symbols);
        const already = earned.length > 0;
        return base(
          Math.min(sectors.length, 3),
          3,
          already || sectors.length >= 3,
          sectors.length ? `Holding ${sectors.length} sector${sectors.length === 1 ? "" : "s"}: ${sectors.join(", ")}.` : "No single-sector positions yet. Your index funds don't count here.",
        );
      }
      case "hold-dip": {
        const done = earned.length > 0;
        const watching = state.dips;
        const detail = done
          ? "You held a dipping position back to break-even."
          : watching.length
            ? `Watching ${watching.map((d) => `${d.symbol} (${d.dipPct.toFixed(1)}%)`).join(", ")}: hold until it's back to your cost.`
            : "None of your positions has dipped 5% below cost yet.";
        return base(done ? 1 : 0, 1, done, detail);
      }
      case "beat-spy-month": {
        const d = new Date(now);
        const cur = monthRange(d.getFullYear(), d.getMonth());
        const prev = monthRange(d.getFullYear(), d.getMonth() - 1);
        const prevKey = monthKey(new Date(prev.start));
        const prevPerf = ms(state.createdAt) < prev.end ? periodReturns(state.snapshots, prev.start, prev.end) : null;
        const prevBeat = Boolean(prevPerf && prevPerf.returnPct > prevPerf.spyReturnPct);
        const curPerf = periodReturns(state.snapshots, cur.start, now + 1);
        const daysLeft = Math.max(0, Math.ceil((cur.end - now) / DAY));
        let detail: string;
        if (curPerf) {
          const diff = round2(curPerf.returnPct - curPerf.spyReturnPct);
          detail = `This month: you ${curPerf.returnPct.toFixed(2)}% vs SPY ${curPerf.spyReturnPct.toFixed(2)}% (${diff >= 0 ? "ahead" : "behind"} by ${Math.abs(diff).toFixed(2)} pts), ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;
        } else {
          detail = "Not enough price history this month yet. Keep Sentia open now and then to record it.";
        }
        const alreadyPrev = badges.some((b) => b.id === `${def.id}:${prevKey}`);
        const ahead = curPerf ? Math.max(0, Math.min(1, 0.5 + (curPerf.returnPct - curPerf.spyReturnPct) / 4)) : 0;
        return {
          ...base(0, 1, prevBeat || alreadyPrev, detail, `${def.id}:${prevKey}`),
          ratio: ahead,
        };
      }
      default:
        return base(0, 1, false, "");
    }
  });
}

/** Badge ids that are complete but not yet recorded. */
export function newlyEarned(state: AppState, progress: ChallengeProgress[]): string[] {
  const have = new Set(state.badges.map((b) => b.id));
  return progress.filter((p) => p.done && !have.has(p.badgeId)).map((p) => p.badgeId);
}

export function awardBadges(state: AppState, ids: string[]): AppState {
  const have = new Set(state.badges.map((b) => b.id));
  const add = [...new Set(ids)].filter((id) => !have.has(id)).map((id) => ({ id, earnedAt: nowIso() }));
  if (!add.length) return state;
  return commit({ ...state, badges: [...state.badges, ...add].slice(-LIMITS.maxBadges) });
}

export function challengeForBadge(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id.split(":")[0]);
}

/**
 * "Hold through a dip" tracking, run on each price update. A holding seen 5%+ below
 * its average cost is watched; if it later trades at or above cost while still held
 * (same position, never fully sold), the "hold-dip" badge is earned. Watches for
 * positions that were sold are dropped.
 */
export function trackDips(state: AppState, quotes: Quote[], now: number = Date.now()): { state: AppState; earned: boolean } {
  const prices = quoteMap(quotes);
  const held = new Map(state.holdings.map((h) => [h.id, h]));
  let dips: DipWatch[] = state.dips.filter((d) => held.has(d.holdingId));
  let changed = dips.length !== state.dips.length;
  let earned = false;
  const hasBadge = state.badges.some((b) => b.id === "hold-dip");

  for (const h of state.holdings) {
    const q = prices.get(normalizeSymbol(h.symbol));
    if (!q || !(q.price > 0) || !(h.avgCost > 0)) continue;
    const pct = ((q.price - h.avgCost) / h.avgCost) * 100;
    const watch = dips.find((d) => d.holdingId === h.id);
    if (watch) {
      if (q.price >= h.avgCost) {
        dips = dips.filter((d) => d !== watch);
        changed = true;
        if (!hasBadge) earned = true;
      } else if (pct < watch.dipPct) {
        dips = dips.map((d) => (d === watch ? { ...d, dipPct: Math.max(-100, round2(pct)) } : d));
        changed = true;
      }
    } else if (pct <= DIP_THRESHOLD_PCT && dips.length < LIMITS.maxHoldings) {
      dips = [...dips, { holdingId: h.id, symbol: normalizeSymbol(h.symbol), dipAt: new Date(now).toISOString(), dipPct: Math.max(-100, round2(pct)) }];
      changed = true;
    }
  }
  if (!changed) return { state, earned: false };
  let next: AppState = commit({ ...state, dips });
  if (earned) next = awardBadges(next, ["hold-dip"]);
  return { state: next, earned };
}
