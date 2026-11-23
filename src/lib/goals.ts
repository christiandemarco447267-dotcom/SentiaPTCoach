// Practice goals picked in the guided first session (v5).
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
