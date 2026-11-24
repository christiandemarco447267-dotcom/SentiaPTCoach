// Derived experience assessment (v6). Combines every setup pick (up to 3 per
// question) plus optional tracked behaviour into one level, a 0–100 score and
// 1–3 plain-English reasons. Pure; unit-tested in experience.test.ts.
import { isDecisionTrade } from "./biases";
import type { AppState, ExperienceSignal, FocusArea, PracticeGoal, Profile } from "./types";

export const EXPERIENCE_TIERS = ["beginner", "developing", "intermediate", "advanced"] as const;
export type ExperienceTier = (typeof EXPERIENCE_TIERS)[number];

export const TIER_LABELS: Record<ExperienceTier, string> = {
  beginner: "Beginner",
  developing: "Developing",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** Self-reported experience: the main signal (0–100 each). */
export const EXPERIENCE_WEIGHTS: Record<ExperienceSignal, number> = {
  new: 10,
  paper: 35,
  retirement: 40,
  some: 45,
  experienced: 80,
  active: 90,
};

/** Supporting signals: small nudges (the average of the picks is applied). */
export const FOCUS_NUDGE: Record<FocusArea, number> = { learn: -8, explore: -3, discipline: 4, growth: 4 };
export const GOAL_NUDGE: Record<PracticeGoal, number> = { learn: -8, plan: 3, diversify: 4, "beat-market": 6 };

/** Score with no experience answer at all (a cautious beginner). */
export const UNANSWERED_BASE = 25;
/** Each extra (non-"new") experience pick beyond the first adds this, up to 2 extras (+6). */
export const BREADTH_BONUS = 3;
/** Lower bounds of each tier. */
export const TIER_FLOORS: Record<ExperienceTier, number> = { beginner: 0, developing: 30, intermediate: 50, advanced: 72 };

export type BehaviorSignals = {
  /** Buys + sells placed in the paper account. */
  trades: number;
  /** Buys that carried a pre-trade plan. */
  plannedBuys: number;
  buys: number;
  /** Sells that were reviewed afterwards. */
  reviewedSells: number;
  sells: number;
};

export type ExperienceAssessment = {
  tier: ExperienceTier;
  label: string;
  score: number;
  reasons: string[];
  /** False when no setup answers exist yet (the result is a placeholder). */
  answered: boolean;
};

const EXPERIENCE_PHRASE: Record<ExperienceSignal, string> = {
  new: "you're new to investing",
  some: "you know the basics",
  experienced: "you invest regularly",
  paper: "you've tried paper trading",
  retirement: "you have a retirement account",
  active: "you trade actively",
};
const FOCUS_PHRASE: Record<FocusArea, string> = {
  learn: "you want to learn the basics",
  explore: "you're mainly exploring",
  discipline: "you're working on a repeatable process",
  growth: "you're tracking long-term growth",
};
const GOAL_PHRASE: Record<PracticeGoal, string> = {
  learn: "learning the basics is a goal",
  plan: "you want to trade with a plan",
  diversify: "you're aiming for a balanced portfolio",
  "beat-market": "you want to measure yourself against the S&P 500",
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function tierForScore(score: number): ExperienceTier {
  if (score >= TIER_FLOORS.advanced) return "advanced";
  if (score >= TIER_FLOORS.intermediate) return "intermediate";
  if (score >= TIER_FLOORS.developing) return "developing";
  return "beginner";
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Behaviour nudge: up to +10 for a real practice history with good habits. */
export function behaviorNudge(b: BehaviorSignals | undefined): { points: number; reason: string | null } {
  if (!b || b.trades <= 0) return { points: 0, reason: null };
  let points = 0;
  const bits: string[] = [];
  if (b.trades >= 20) {
    points += 5;
    bits.push(`${b.trades} practice trades`);
  } else if (b.trades >= 5) {
    points += 2;
    bits.push(`${b.trades} practice trades`);
  }
  const journaled = b.plannedBuys + b.reviewedSells;
  const journalable = b.buys + b.sells;
  if (journalable >= 5 && journaled / journalable >= 0.5) {
    points += 5;
    bits.push("a well-kept trade journal");
  }
  return { points, reason: bits.length ? `Your history adds weight: ${listPhrase(bits)}.` : null };
}

/** Count the habits that feed behaviorNudge from the saved account (the user's own trades only). */
export function behaviorFromState(state: Pick<AppState, "transactions">): BehaviorSignals {
  let buys = 0;
  let sells = 0;
  let plannedBuys = 0;
  let reviewedSells = 0;
  for (const tx of state.transactions) {
    // Seeded opening positions aren't the user's decisions.
    if (!isDecisionTrade(tx)) continue;
    if (tx.type === "buy") {
      buys += 1;
      if (tx.plan) plannedBuys += 1;
    } else if (tx.type === "sell") {
      sells += 1;
      if (tx.review) reviewedSells += 1;
    }
  }
  return { trades: buys + sells, buys, sells, plannedBuys, reviewedSells };
}

/**
 * Combine the setup picks into one assessment.
 *  1. Base = average weight of the experience picks (the main signal), or 25 if unanswered.
 *     Contradictory picks ("new" with "experienced"/"active") simply average to the middle,
 *     with a reason saying so; otherwise each extra non-"new" pick adds +3 (max +6).
 *  2. + average focus nudge (−8…+4) + average goal nudge (−8…+6).
 *  3. + behaviour nudge (0…+10) when tracked history is supplied.
 *  4. Clamp 0–100, round; tiers: <30 beginner, <50 developing, <72 intermediate, else advanced.
 */
export function assessExperience(
  profile: Pick<Profile, "experiences" | "focuses" | "goals">,
  behavior?: BehaviorSignals,
): ExperienceAssessment {
  const exp = [...new Set(profile.experiences)];
  const focuses = [...new Set(profile.focuses)];
  const goals = [...new Set(profile.goals)];
  const reasons: string[] = [];

  let base = UNANSWERED_BASE;
  const contradictory = exp.includes("new") && (exp.includes("experienced") || exp.includes("active"));
  if (exp.length) {
    base = mean(exp.map((e) => EXPERIENCE_WEIGHTS[e]));
    if (contradictory) {
      reasons.push(`You picked both "new to investing" and a more experienced answer, so we've placed you in the middle for now.`);
    } else {
      const extras = exp.filter((e) => e !== "new").length - 1;
      base += BREADTH_BONUS * clamp(extras, 0, 2);
      // Strongest self-report first.
      const ordered = [...exp].sort((a, b) => EXPERIENCE_WEIGHTS[b] - EXPERIENCE_WEIGHTS[a]);
      reasons.push(`${cap(listPhrase(ordered.map((e) => EXPERIENCE_PHRASE[e])))}.`);
    }
  } else {
    reasons.push("You haven't told us your experience yet, so this is a cautious starting guess.");
  }

  const focusAdj = mean(focuses.map((f) => FOCUS_NUDGE[f]));
  const goalAdj = mean(goals.map((g) => GOAL_NUDGE[g]));
  // The single most telling supporting answer becomes the second reason.
  const supporting = [
    ...focuses.map((f) => ({ adj: FOCUS_NUDGE[f], text: FOCUS_PHRASE[f] })),
    ...goals.map((g) => ({ adj: GOAL_NUDGE[g], text: GOAL_PHRASE[g] })),
  ].sort((a, b) => Math.abs(b.adj) - Math.abs(a.adj));
  const support = focusAdj + goalAdj;
  if (supporting.length && Math.abs(support) >= 2) {
    const pick = supporting.find((s) => Math.sign(s.adj) === Math.sign(support)) ?? supporting[0];
    reasons.push(support < 0 ? `${cap(pick.text)}, so explanations stay simple.` : `${cap(pick.text)}, which points to some confidence.`);
  }

  const beh = behaviorNudge(behavior);
  if (beh.reason) reasons.push(beh.reason);

  const score = Math.round(clamp(base + support + beh.points));
  const tier = tierForScore(score);
  return {
    tier,
    label: TIER_LABELS[tier],
    score,
    reasons: reasons.slice(0, 3),
    answered: exp.length + focuses.length + goals.length > 0,
  };
}

/** Assessment for the saved account (profile picks + tracked trades/journal). */
export function assessState(state: Pick<AppState, "profile" | "transactions">): ExperienceAssessment {
  return assessExperience(state.profile, behaviorFromState(state));
}

/** How the coach should pitch explanations at each tier (used by the AI context and built-in tips). */
export const TIER_TONE: Record<ExperienceTier, string> = {
  beginner: "Use plain words, define any term (e.g. cost basis, ETF) the first time, and keep to one idea at a time.",
  developing: "Assume the basics (orders, ETFs); briefly explain anything beyond them.",
  intermediate: "Skip basic definitions; focus on process, sizing and comparison with the index.",
  advanced: "Be concise and specific; discuss risk, concentration and benchmark gaps directly.",
};

/** "Developing — because you know the basics." */
export function levelSentence(a: ExperienceAssessment): string {
  const first = a.reasons[0] ?? "";
  return first ? `${a.label} — because ${first.charAt(0).toLowerCase()}${first.slice(1)}` : a.label;
}
