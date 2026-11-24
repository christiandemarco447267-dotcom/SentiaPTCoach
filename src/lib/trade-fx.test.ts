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

test("confetti never blocks the page: no pointer events, below dialogs, short, confined, see-through", async () => {
  const { CONFETTI } = await import("./celebrate");
  assert.match(CONFETTI.style, /pointer-events:none/);
  const z = Number(/z-index:(\d+)/.exec(CONFETTI.style)?.[1]);
  assert.ok(z < 55, "below drawers (55), dialogs (60) and toasts (80)");
  assert.ok(CONFETTI.durationMs <= 1200);
  assert.ok(CONFETTI.bandHeight <= 0.5 && /height:40vh/.test(CONFETTI.style));
  assert.ok(CONFETTI.maxAlpha < 1);
});

test("thesis picker shows the full thesis and is sized for 360px phones", async () => {
  const { readFileSync } = await import("node:fs");
  const view = readFileSync("src/components/portfolio-view.tsx", "utf8");
  assert.match(view, /className="select thesis-select"/);
  assert.match(view, /title=\{`\$\{thesis\.symbol\} · \$\{thesis\.title\}`\}/);
  assert.doesNotMatch(view, /maxWidth: 220/);
  const css = readFileSync("src/app/polish.css", "utf8");
  assert.match(css, /\.thesis-select \{[^}]*min-width: 0;[^}]*max-width: 100%;/);
});
