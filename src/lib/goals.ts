// Practice goals picked in the guided first session (v5).
import type { ExperienceTier } from "./experience";
import type { PracticeGoal } from "./types";

export const GOAL_OPTIONS: { value: PracticeGoal; label: string; hint: string }[] = [
  { value: "beat-market", label: "Beat the S&P 500", hint: "Measure every decision against simply buying the index." },
  { value: "plan", label: "Trade with a plan", hint: "Know why you buy, when you'll sell, and what you can lose." },
  { value: "diversify", label: "Build a balanced portfolio", hint: "Spread money across sectors so one bet can't sink you." },
  { value: "learn", label: "Learn the basics", hint: "Get comfortable with orders, cost basis and dips, risk-free." },
];

export function goalInfo(goal: PracticeGoal): { value: PracticeGoal; label: string; hint: string } {
  return GOAL_OPTIONS.find((g) => g.value === goal) ?? GOAL_OPTIONS[0];
}

/** Starter tickers for the guided first trade, per goal. */
export const PICKS: Record<PracticeGoal, string[]> = {
  "beat-market": ["VOO", "AAPL", "MSFT"],
  plan: ["AAPL", "VOO", "NVDA"],
  diversify: ["SCHD", "VXUS", "AAPL"],
  learn: ["VOO", "AAPL", "SCHD"],
};
/** v6: the first trade's starting amount follows the derived experience level. */
export const DEFAULT_AMOUNT: Record<ExperienceTier, number> = { beginner: 250, developing: 500, intermediate: 1000, advanced: 1000 };

/** Up to 3 distinct starter tickers drawn from every goal picked (first goal first). */
export function picksForGoals(goals: readonly PracticeGoal[]): string[] {
  const out: string[] = [];
  const lists = (goals.length ? goals : (["learn"] as PracticeGoal[])).map((g) => PICKS[g]);
  for (let i = 0; out.length < 3 && i < 3; i++) {
    for (const list of lists) {
      const s = list[i];
      if (s && !out.includes(s) && out.length < 3) out.push(s);
    }
  }
  return out;
}

