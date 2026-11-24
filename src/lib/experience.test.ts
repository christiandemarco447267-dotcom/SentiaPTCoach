import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessExperience,
  assessState,
  behaviorFromState,
  behaviorNudge,
  levelSentence,
  tierForScore,
} from "./experience";
import { DEFAULT_AMOUNT, picksForGoals } from "./goals";
import { cleanPicks, pickCounter, pickLocked, togglePick } from "./multi-pick";
import { buy, createInitialState, migrateUnknown, migrateV5, saveProfile, sell, setPracticeGoals } from "./storage";
import { AppStateSchema, EXPERIENCE_LEVELS, MAX_SETUP_PICKS, PRACTICE_GOALS, SCHEMA_VERSION, type Profile } from "./types";

const P = (p: Partial<Pick<Profile, "experiences" | "focuses" | "goals">>) => ({ experiences: [], focuses: [], goals: [], ...p });

// ---- max-3 enforcement -------------------------------------------------------------------

test("togglePick adds up to 3, ignores a 4th, and removes on a second tap", () => {
  assert.equal(MAX_SETUP_PICKS, 3);
  let s: string[] = [];
  for (const v of ["a", "b", "c", "d"]) s = togglePick(s, v);
  assert.deepEqual(s, ["a", "b", "c"]);
  assert.equal(pickLocked(s, "d"), true);
  assert.equal(pickLocked(s, "a"), false);
  assert.equal(pickCounter(s.length), "3 of 3");
  s = togglePick(s, "b");
  assert.deepEqual(s, ["a", "c"]);
  assert.equal(pickLocked(s, "d"), false);
  assert.equal(pickCounter(2), "2 of 3");
});

test("cleanPicks drops duplicates, unknown values and extras", () => {
  assert.deepEqual(cleanPicks(["learn", "learn", "nope", "plan", "diversify", "beat-market"], PRACTICE_GOALS), ["learn", "plan", "diversify"]);
  assert.deepEqual(cleanPicks(null, PRACTICE_GOALS), []);
});

test("saveProfile and setPracticeGoals cap each answer at 3", () => {
  const s = saveProfile(createInitialState(), { experiences: ["new", "some", "paper", "active"], focuses: ["learn", "learn"] });
  assert.deepEqual(s.profile.experiences, ["new", "some", "paper"]);
  assert.deepEqual(s.profile.focuses, ["learn"]);
  const g = setPracticeGoals(s, [...PRACTICE_GOALS]);
  assert.equal(g.profile.goals.length, 3);
  assert.ok(AppStateSchema.safeParse(g).success);
});

test("the schema rejects nothing but trims over-long pick lists to 3", () => {
  const s = createInitialState();
  const parsed = AppStateSchema.parse({ ...s, profile: { ...s.profile, experiences: [...EXPERIENCE_LEVELS] } });
  assert.equal(parsed.profile.experiences.length, 3);
});

// ---- v5 → v6 migration --------------------------------------------------------------------

function v5State(profile: Record<string, unknown>) {
  const s = JSON.parse(JSON.stringify(createInitialState())) as Record<string, unknown>;
  return { ...s, version: 5, profile };
}

test("a saved v5 profile's single answers become 1-item lists", () => {
  const migrated = migrateUnknown(v5State({ experience: "experienced", focus: "growth", avatarColor: "#7c3aed", goal: "diversify" }));
  assert.ok(migrated);
  assert.equal(migrated.version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 6);
  assert.deepEqual(migrated.profile, { experiences: ["experienced"], focuses: ["growth"], avatarColor: "#7c3aed", goals: ["diversify"] });
  assert.equal("experience" in migrated.profile, false);
});

test("null v5 answers become empty lists and other account data survives", () => {
  const src = v5State({ experience: null, focus: null, avatarColor: "#0d9488", goal: null });
  const migrated = migrateUnknown(src);
  assert.ok(migrated);
  assert.deepEqual([migrated.profile.experiences, migrated.profile.focuses, migrated.profile.goals], [[], [], []]);
  assert.equal(migrated.cash, (src as unknown as { cash: number }).cash);
  assert.equal(migrated.transactions.length, (src as unknown as { transactions: unknown[] }).transactions.length);
});

test("migrateV5 keeps lists that already exist and drops unknown values", () => {
  const out = migrateV5({ version: 5, profile: { experience: "bogus", focuses: ["learn"], goal: "plan" } });
  assert.deepEqual(out.profile, { avatarColor: "#0d9488", experiences: [], focuses: ["learn"], goals: ["plan"] });
});

test("a v4 profile still migrates all the way to v6", () => {
  const s = JSON.parse(JSON.stringify(createInitialState())) as Record<string, unknown>;
  const v4 = { ...s, version: 4, profile: { experience: "some", focus: "learn", avatarColor: "#2563eb" } };
  delete (v4 as Record<string, unknown>).reports;
  const migrated = migrateUnknown(v4);
  assert.ok(migrated);
  assert.deepEqual(migrated.profile, { experiences: ["some"], focuses: ["learn"], avatarColor: "#2563eb", goals: [] });
});

// ---- experience scoring --------------------------------------------------------------------

test("tiers by score", () => {
  assert.deepEqual([0, 29, 30, 49, 50, 71, 72, 100].map(tierForScore), [
    "beginner", "beginner", "developing", "developing", "intermediate", "intermediate", "advanced", "advanced",
  ]);
});

test("self-reported experience is the main signal", () => {
  assert.equal(assessExperience(P({ experiences: ["new"] })).tier, "beginner");
  assert.equal(assessExperience(P({ experiences: ["some"] })).tier, "developing");
  assert.equal(assessExperience(P({ experiences: ["experienced"] })).tier, "advanced");
  const pro = assessExperience(P({ experiences: ["experienced", "active"] }));
  assert.equal(pro.score, 88);
  assert.equal(pro.tier, "advanced");
});

test("supporting answers nudge but never outweigh the self-report", () => {
  const a = assessExperience(P({ experiences: ["experienced"], focuses: ["learn"], goals: ["learn"] }));
  assert.equal(a.score, 64);
  assert.equal(a.tier, "intermediate");
  assert.match(a.reasons[1], /simple/);
  const b = assessExperience(P({ experiences: ["new"], focuses: ["growth", "discipline"], goals: ["beat-market"] }));
  assert.equal(b.score, 20);
  assert.equal(b.tier, "beginner");
});

test("contradictory picks land in the middle with a reason", () => {
  const a = assessExperience(P({ experiences: ["new", "experienced"] }));
  assert.equal(a.score, 45);
  assert.equal(a.tier, "developing");
  assert.match(a.reasons[0], /both/);
  assert.equal(assessExperience(P({ experiences: ["new", "experienced", "active"] })).tier, "intermediate");
});

test("broader experience adds a little (+3 per extra pick)", () => {
  assert.equal(assessExperience(P({ experiences: ["some", "paper"] })).score, 43);
  assert.equal(assessExperience(P({ experiences: ["some", "paper", "retirement"] })).score, 46);
});

test("unanswered setup is a cautious beginner placeholder", () => {
  const a = assessExperience(P({}));
  assert.equal(a.score, 25);
  assert.equal(a.tier, "beginner");
  assert.equal(a.answered, false);
  assert.equal(a.reasons.length, 1);
});

test("reasons are 1–3 plain sentences and levelSentence reads naturally", () => {
  const a = assessExperience(P({ experiences: ["some", "paper"], focuses: ["learn"], goals: ["learn"] }), { trades: 25, buys: 15, sells: 10, plannedBuys: 12, reviewedSells: 6 });
  assert.ok(a.reasons.length >= 1 && a.reasons.length <= 3);
  for (const r of a.reasons) assert.match(r, /^[A-Z].*\.$/);
  assert.equal(levelSentence(assessExperience(P({ experiences: ["some"] }))), "Developing — because you know the basics.");
});

test("tracked behaviour adds up to +10", () => {
  assert.deepEqual(behaviorNudge(undefined), { points: 0, reason: null });
  assert.equal(behaviorNudge({ trades: 6, buys: 4, sells: 2, plannedBuys: 0, reviewedSells: 0 }).points, 2);
  assert.equal(behaviorNudge({ trades: 25, buys: 15, sells: 10, plannedBuys: 12, reviewedSells: 6 }).points, 10);
  const a = assessExperience(P({ experiences: ["some"] }), { trades: 25, buys: 15, sells: 10, plannedBuys: 12, reviewedSells: 6 });
  assert.equal(a.score, 55);
  assert.equal(a.tier, "intermediate");
  assert.match(a.reasons.at(-1) ?? "", /journal/);
});

test("behaviorFromState counts plans and reviews from the ledger", () => {
  let s = createInitialState();
  s = buy(s, { symbol: "VOO", shares: 1, price: 100 }, "", { plan: { why: "index", exit: "1 week", risk: 10 } });
  s = buy(s, { symbol: "AAPL", shares: 1, price: 100 });
  s = sell(s, { symbol: "AAPL", shares: 1, price: 110 });
  const b = behaviorFromState(s);
  // Seeded opening positions are ignored; only the 3 trades above count.
  assert.deepEqual(b, { trades: 3, buys: 2, sells: 1, plannedBuys: 1, reviewedSells: 0 });
  assert.equal(assessState(s).tier, "beginner");
});

test("guided session: starter picks blend every goal, and the amount follows the level", () => {
  assert.deepEqual(picksForGoals([]), ["VOO", "AAPL", "SCHD"]);
  assert.deepEqual(picksForGoals(["diversify"]), ["SCHD", "VXUS", "AAPL"]);
  assert.deepEqual(picksForGoals(["diversify", "plan"]), ["SCHD", "AAPL", "VXUS"]);
  assert.equal(picksForGoals(["learn", "plan", "diversify"]).length, 3);
  assert.deepEqual([DEFAULT_AMOUNT.beginner, DEFAULT_AMOUNT.developing, DEFAULT_AMOUNT.advanced], [250, 500, 1000]);
});
