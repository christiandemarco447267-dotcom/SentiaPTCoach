import assert from "node:assert/strict";
import { test } from "node:test";
import { canVibrate } from "./celebrate";
import { healthAllowsSearch } from "./symbols";

// Ticker search only calls /search when the Worker's /health lists it.
test("healthAllowsSearch needs an explicit search: true", () => {
  assert.equal(healthAllowsSearch({ ok: true, search: true }), true);
  assert.equal(healthAllowsSearch({ ok: true, quotes: { finnhub: true } }), false); // older Worker
  assert.equal(healthAllowsSearch({ ok: true, search: false }), false);
  assert.equal(healthAllowsSearch({ search: "true" }), false);
  assert.equal(healthAllowsSearch(null), false);
  assert.equal(healthAllowsSearch("ok"), false);
});

// Vibration waits for the first tap, so browsers don't log a blocked-call error.
test("canVibrate respects user activation", () => {
  const vibrate = () => true;
  assert.equal(canVibrate({ vibrate, userActivation: { hasBeenActive: false } }), false);
  assert.equal(canVibrate({ vibrate, userActivation: { hasBeenActive: true } }), true);
  assert.equal(canVibrate({ vibrate }), true); // no userActivation API: try anyway
  assert.equal(canVibrate({}), false); // iOS Safari: no vibrate
  assert.equal(canVibrate(undefined), false);
});
