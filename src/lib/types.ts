import { z } from "zod";
import { LIMITS, SYMBOL_REGEX } from "./validation";

export const SCHEMA_VERSION = 6 as const;

const isoDate = z.string().datetime();
const uuid = z.string().uuid();

// "order" is an informational ledger entry (e.g. a pending order rejected at fill time); it moves no money.
export const TRANSACTION_TYPES = ["buy", "sell", "deposit", "withdraw", "order"] as const;

export const HoldingSchema = z.object({
  id: uuid,
  symbol: z.string().trim().min(1).max(LIMITS.symbolMax).regex(SYMBOL_REGEX, "Invalid ticker symbol"),
  name: z.string().trim().min(1).max(LIMITS.nameMax),
  shares: z.number().positive().max(LIMITS.maxShares),
  avgCost: z.number().nonnegative().max(LIMITS.maxPrice),
  thesisId: uuid.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Holding = z.infer<typeof HoldingSchema>;

// ---- v4: optional mood tag on trades -------------------------------------

export const MOODS = ["confident", "anxious", "bored", "excited", "calm"] as const;
export type Mood = (typeof MOODS)[number];

// ---- v4: thesis stress test ---------------------------------------------------

export const StressTestSchema = z.object({
  /** "What would prove this wrong?" */
  disproof: z.string().trim().min(1).max(LIMITS.risksMax),
  /** Optional exit trigger price, watched in the direction given. */
  exitPrice: z.number().positive().max(LIMITS.maxPrice).optional(),
  exitDirection: z.enum(["above", "below"]).default("below"),
  /** Free-text exit condition (e.g. "two quarters of falling margins"). */
  exitCondition: z.string().trim().max(300).default(""),
  /** Price alert created from this stress test, if any. */
  alertId: uuid.optional(),
  createdAt: isoDate,
});
export type StressTest = z.infer<typeof StressTestSchema>;

export const ThesisSchema = z.object({
  id: uuid,
  symbol: z.string().trim().min(1).max(LIMITS.symbolMax).regex(SYMBOL_REGEX, "Invalid ticker symbol"),
  title: z.string().trim().min(1).max(LIMITS.titleMax),
  rationale: z.string().trim().min(1).max(LIMITS.rationaleMax),
  risks: z.string().trim().max(LIMITS.risksMax).default(""),
  conviction: z.number().int().min(1).max(5).default(3),
  stressTest: StressTestSchema.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Thesis = z.infer<typeof ThesisSchema>;

// ---- v5: pre-trade plan (checklist answers) and post-trade review -------------------

export const TradePlanSchema = z.object({
  /** Why am I buying? */
  why: z.string().trim().min(1).max(300),
  /** Exit plan: when will I sell (target, stop, or thesis break)? */
  exit: z.string().trim().min(1).max(300),
  /** Dollars I'm prepared to lose on this trade. */
  risk: z.number().nonnegative().max(LIMITS.maxMoney),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;

export const TradeReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  lesson: z.string().trim().max(500).default(""),
  reviewedAt: isoDate,
});
export type TradeReview = z.infer<typeof TradeReviewSchema>;

export const TransactionSchema = z.object({
  id: uuid,
  type: z.enum(TRANSACTION_TYPES),
  symbol: z.string().trim().min(1).max(LIMITS.symbolMax).optional(),
  shares: z.number().positive().max(LIMITS.maxShares).optional(),
  price: z.number().nonnegative().max(LIMITS.maxPrice).optional(),
  amount: z.number().nonnegative().max(LIMITS.maxMoney),
  realizedGain: z.number().optional(),
  cashAfter: z.number().nonnegative().max(LIMITS.maxMoney),
  note: z.string().trim().max(200).default(""),
  /** v4: optional mood the user tagged the trade with. */
  mood: z.enum(MOODS).optional(),
  /** v4: the symbol's day change (%) when the trade was placed, if a quote was available (used by Bias Radar). */
  dayChange: z.number().min(-100).max(10_000).optional(),
  /** v4: thesis linked to the position at trade time (celebrations, share cards). */
  thesisId: uuid.optional(),
  /** v5: pre-trade checklist answers (buys). */
  plan: TradePlanSchema.optional(),
  /** v5: post-trade review (sells). */
  review: TradeReviewSchema.optional(),
  createdAt: isoDate,
});
export type Transaction = z.infer<typeof TransactionSchema>;

/**
 * Self-reported experience picks (v6: multi-select, up to 3). The first three are
 * the original v5 answers; the rest are extra signals that sharpen the level estimate.
 */
export const EXPERIENCE_LEVELS = ["new", "some", "experienced", "paper", "retirement", "active"] as const;
export type ExperienceSignal = (typeof EXPERIENCE_LEVELS)[number];
export const FOCUS_AREAS = ["learn", "discipline", "growth", "explore"] as const;
export type FocusArea = (typeof FOCUS_AREAS)[number];
/** v5: the practice goal picked in the guided first session (v6: up to 3). */
export const PRACTICE_GOALS = ["beat-market", "plan", "diversify", "learn"] as const;
export type PracticeGoal = (typeof PRACTICE_GOALS)[number];

/** v6: every setup question allows up to this many picks. */
export const MAX_SETUP_PICKS = 3;

/** An array of distinct enum picks, at most MAX_SETUP_PICKS long (extras and duplicates are dropped, never rejected). */
function picks<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .array(z.enum(values))
    .default([])
    .transform((list) => [...new Set(list)].slice(0, MAX_SETUP_PICKS));
}

export const ProfileSchema = z.object({
  /** v6 (was `experience`, a single value in v5). */
  experiences: picks(EXPERIENCE_LEVELS),
  /** v6 (was `focus`). */
  focuses: picks(FOCUS_AREAS),
  avatarColor: z.string().trim().max(9).default("#0d9488"),
  /** v6 (was `goal`). */
  goals: picks(PRACTICE_GOALS),
});
export type Profile = z.infer<typeof ProfileSchema>;
export const DEFAULT_PROFILE: Profile = { experiences: [], focuses: [], avatarColor: "#0d9488", goals: [] };

const symbolField = z.string().trim().min(1).max(LIMITS.symbolMax).regex(SYMBOL_REGEX, "Invalid ticker symbol");

// ---- v3: watchlist + price alerts ----------------------------------------

export const ALERT_DIRECTIONS = ["above", "below"] as const;
export const ALERT_STATUSES = ["active", "triggered"] as const;

export const PriceAlertSchema = z.object({
  id: uuid,
  symbol: symbolField,
  direction: z.enum(ALERT_DIRECTIONS),
  price: z.number().positive().max(LIMITS.maxPrice),
  status: z.enum(ALERT_STATUSES).default("active"),
  createdAt: isoDate,
  triggeredAt: isoDate.optional(),
  triggeredPrice: z.number().nonnegative().max(LIMITS.maxPrice).optional(),
});
export type PriceAlert = z.infer<typeof PriceAlertSchema>;

// ---- v3: pending limit / stop orders --------------------------------------

export const ORDER_SIDES = ["buy", "sell"] as const;
export const ORDER_TYPES = ["limit", "stop"] as const;
export const ORDER_STATUSES = ["open", "filled", "cancelled", "rejected"] as const;

export const PendingOrderSchema = z.object({
  id: uuid,
  symbol: symbolField,
  side: z.enum(ORDER_SIDES),
  type: z.enum(ORDER_TYPES),
  shares: z.number().positive().max(LIMITS.maxShares),
  /** Limit price (limit orders) or stop/trigger price (stop orders). */
  triggerPrice: z.number().positive().max(LIMITS.maxPrice),
  status: z.enum(ORDER_STATUSES).default("open"),
  createdAt: isoDate,
  updatedAt: isoDate,
  filledAt: isoDate.optional(),
  fillPrice: z.number().nonnegative().max(LIMITS.maxPrice).optional(),
  reason: z.string().trim().max(200).optional(),
  /** Pre-trade checklist answers for a limit/stop buy, saved on the buy when it fills. */
  plan: TradePlanSchema.optional(),
});
export type PendingOrder = z.infer<typeof PendingOrderSchema>;

// ---- v3: performance snapshots (portfolio vs. SPY) -------------------------

export const PerfSnapshotSchema = z.object({
  t: isoDate,
  /** Total portfolio value (cash + positions at market). */
  value: z.number().nonnegative().max(LIMITS.maxMoney * 10),
  /** SPY price at the same moment, from the same market feed. */
  spy: z.number().positive().max(LIMITS.maxPrice),
  /** Net external cash flow (deposits − withdrawals) since the previous snapshot. */
  flow: z.number().min(-LIMITS.maxMoney).max(LIMITS.maxMoney).default(0),
  /** Price feed the snapshot was valued with. Absent on older snapshots, which were all simulated ("demo"). */
  src: z.enum(["live", "demo"]).optional(),
});
export type PerfSnapshot = z.infer<typeof PerfSnapshotSchema>;

// ---- v4: Time Machine replay sessions (separate practice account) ---------------

export const ReplayTradeSchema = z.object({
  day: z.number().int().nonnegative().max(10_000),
  side: z.enum(ORDER_SIDES),
  symbol: symbolField,
  shares: z.number().positive().max(LIMITS.maxShares),
});
export type ReplayTrade = z.infer<typeof ReplayTradeSchema>;

export const ReplaySessionSchema = z.object({
  id: uuid,
  scenarioId: z.string().trim().min(1).max(40),
  startCash: z.number().positive().max(LIMITS.maxMoney),
  /** Index into the scenario's trading days (the "today" of the replay). */
  dayIndex: z.number().int().nonnegative().max(10_000),
  trades: z.array(ReplayTradeSchema).max(LIMITS.maxReplayTrades).default([]),
  startedAt: isoDate,
  finishedAt: isoDate.optional(),
});
export type ReplaySession = z.infer<typeof ReplaySessionSchema>;

export const ReplayResultSchema = z.object({
  scenarioId: z.string().trim().min(1).max(40),
  returnPct: z.number().min(-100).max(100_000),
  spyReturnPct: z.number().min(-100).max(100_000),
  maxDrawdownPct: z.number().min(0).max(100),
  trades: z.number().int().nonnegative(),
  finishedAt: isoDate,
});
export type ReplayResult = z.infer<typeof ReplayResultSchema>;

export const SettingsSchema = z.object({
  /** Confetti on wins and milestones (always skipped when the OS asks for reduced motion). */
  celebrations: z.boolean().default(true),
  /** Short vibration on supported phones. */
  haptics: z.boolean().default(true),
  /** v5: ask the 3 pre-trade questions before a market buy. */
  preTradeChecklist: z.boolean().default(true),
  /** v5: mirror price alerts and order fills to system (phone) notifications. */
  alertNotifications: z.boolean().default(false),
});
export const DEFAULT_SETTINGS = { celebrations: true, haptics: true, preTradeChecklist: true, alertNotifications: false } as const;
export type Settings = z.infer<typeof SettingsSchema>;

export const AchievementsSchema = z.object({
  /** Highest Discipline Score milestone already recorded (null = not yet baselined). */
  disciplineMilestone: z.number().int().min(0).max(100).nullable().default(null),
  /** The "sample starter portfolio" banner was dismissed (kept, or replaced with cash). */
  starterNoticeDismissed: z.boolean().optional(),
});

// ---- v5: weekly report cards, badges and "hold through a dip" tracking ----------

export const ReportTradeSchema = z.object({
  symbol: symbolField,
  gain: z.number().min(-LIMITS.maxMoney).max(LIMITS.maxMoney),
  gainPct: z.number().min(-100).max(100_000).nullable(),
});
export type ReportTrade = z.infer<typeof ReportTradeSchema>;

export const WeeklyReportSchema = z.object({
  /** Local date (YYYY-MM-DD) of the Monday the week starts on. */
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grade: z.enum(["A", "B", "C", "D", "F"]),
  score: z.number().int().min(0).max(100),
  returnPct: z.number().min(-100).max(100_000).nullable(),
  spyReturnPct: z.number().min(-100).max(100_000).nullable(),
  trades: z.number().int().nonnegative().max(100_000),
  best: ReportTradeSchema.nullable(),
  worst: ReportTradeSchema.nullable(),
  notes: z.array(z.string().trim().max(240)).max(6),
  tip: z.string().trim().min(1).max(900),
  tipSource: z.enum(["coach", "ai"]),
  createdAt: isoDate,
});
export type WeeklyReport = z.infer<typeof WeeklyReportSchema>;

export const BadgeSchema = z.object({
  /** Challenge id, plus ":<period>" for repeatable ones (e.g. "beat-spy-month:2026-10"). */
  id: z.string().regex(/^[a-z0-9-]{1,40}(:[0-9-]{4,10})?$/),
  earnedAt: isoDate,
});
export type Badge = z.infer<typeof BadgeSchema>;

export const DipWatchSchema = z.object({
  holdingId: uuid,
  symbol: symbolField,
  /** When the position was first seen 5%+ below its cost. */
  dipAt: isoDate,
  /** Worst drawdown seen vs cost, in % (negative). */
  dipPct: z.number().min(-100).max(0),
});
export type DipWatch = z.infer<typeof DipWatchSchema>;

export const LEAGUE_CODE_REGEX = /^[A-HJ-NP-Z2-9]{6}$/;

export const AppStateSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  profileName: z.string().trim().max(40).default(""),
  onboardedAt: isoDate.nullable().default(null),
  profileSetupAt: isoDate.nullable().default(null),
  profile: ProfileSchema.default({ ...DEFAULT_PROFILE }),
  cash: z.number().nonnegative().max(LIMITS.maxMoney),
  holdings: z.array(HoldingSchema).max(LIMITS.maxHoldings),
  theses: z.array(ThesisSchema).max(LIMITS.maxTheses),
  transactions: z.array(TransactionSchema).max(LIMITS.maxTransactions),
  watchlist: z.array(symbolField).max(LIMITS.maxWatchlist).default([]),
  alerts: z.array(PriceAlertSchema).max(LIMITS.maxAlerts).default([]),
  orders: z.array(PendingOrderSchema).max(LIMITS.maxOrders).default([]),
  snapshots: z.array(PerfSnapshotSchema).max(LIMITS.maxSnapshots).default([]),
  // v4
  settings: SettingsSchema.default({ ...DEFAULT_SETTINGS }),
  achievements: AchievementsSchema.default({ disciplineMilestone: null }),
  replay: ReplaySessionSchema.nullable().default(null),
  replayHistory: z.array(ReplayResultSchema).max(LIMITS.maxReplayHistory).default([]),
  leagues: z.array(z.string().regex(LEAGUE_CODE_REGEX)).max(LIMITS.maxLeagues).default([]),
  // v5
  reports: z.array(WeeklyReportSchema).max(LIMITS.maxReports).default([]),
  badges: z.array(BadgeSchema).max(LIMITS.maxBadges).default([]),
  dips: z.array(DipWatchSchema).max(LIMITS.maxHoldings).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type AppState = z.infer<typeof AppStateSchema>;

// Market data (never persisted).
/** "live" = real quote, current; "delayed" = real quote that may lag the market; "demo" = simulated. */
export type QuoteSource = "live" | "delayed" | "demo";

export type Quote = {
  symbol: string;
  price: number;
  changePercent: number;
  previousClose: number;
  source: QuoteSource;
  /** Dollar change vs previous close, when the provider reports it. */
  change?: number;
  /** When the price was set (ISO), for real quotes. */
  asOf?: string;
  /** Which provider supplied a real quote (e.g. "finnhub", "yahoo"). */
  provider?: string;
  error?: string;
};

export type MarketStatus = "open" | "closed" | "demo";

export type MarketSnapshot = {
  status: MarketStatus;
  updatedAt: string;
  quotes: Quote[];
};
