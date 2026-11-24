import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeFxEnabled, tradeFxLabel } from "./trade-fx";

test("trade animation label uses the shared share format", () => {
  assert.equal(tradeFxLabel("buy", 5, "aapl"), "Bought 5 AAPL");
  assert.equal(tradeFxLabel("sell", 0.5, "TSLA"), "Sold 0.5 TSLA");
  assert.equal(tradeFxLabel("buy", 1234.56789, "MSFT"), "Bought 1,234.5679 MSFT");
});

test("trade animation respects reduced motion and server rendering", () => {
  assert.equal(tradeFxEnabled(false, true), true);
  assert.equal(tradeFxEnabled(true, true), false);
  assert.equal(tradeFxEnabled(false, false), false);
});
