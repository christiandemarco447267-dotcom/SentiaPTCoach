// Coach text for Quick Start step 3: quotes the user's own numbers (first trade,
// cash, goal) the way Ask Sentia does. Pure; unit-tested.
import { formatCurrency, formatNumber, formatPercent, inSentence } from "./format";
import { goalInfo } from "./goals";
import type { PracticeGoal } from "./types";

export type QuickStartInput = {
  bought: { symbol: string; shares: number; price: number } | null;
  cash: number;
  total: number;
  holdings: number;
  goals: PracticeGoal[];
};

const NEXT_STEP: Record<PracticeGoal, (sym: string | null) => string> = {
  "beat-market": () => "check the You vs. S&P 500 chart on Portfolio after a few days to see whether this idea is beating simply holding the index",
  plan: (sym) => `set a price alert${sym ? ` on ${sym}` : ""} at your exit level so your plan has a trigger`,
  diversify: () => "look at Allocation to see how much of your money sits in one sector",
  learn: (sym) => `open Trade and look at the cost basis${sym ? ` of your ${sym} position` : ""}: it's what the gain or loss is measured from`,
};

export function quickStartCoachText({ bought, cash, total, holdings, goals }: QuickStartInput): string {
  const goal = goals[0];
  const goalText = goal ? `Your goal is to ${inSentence(goalInfo(goal).label)}.` : "";
  const next = goal ? NEXT_STEP[goal](bought?.symbol ?? null) : "write a one-line thesis for your next idea before you buy";
  if (bought) {
    const cost = bought.shares * bought.price;
    const pct = total > 0 ? (cost / total) * 100 : 0;
    return [
      `You bought ${formatNumber(bought.shares)} ${bought.symbol} at ${formatCurrency(bought.price)}, about ${formatCurrency(cost)}.`,
      `That's ${formatPercent(pct, false, 1)} of your ${formatCurrency(total)} account, with ${formatCurrency(cash)} still in cash, so one bad call can't sink you.`,
      goalText,
      `Next: ${next}.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    `You have ${formatCurrency(cash)} in cash${holdings ? ` and ${holdings} position${holdings === 1 ? "" : "s"}` : ""} (${formatCurrency(total)} in total).`,
    goalText,
    `When you're ready, make one small trade with a written reason. Then ${next}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
