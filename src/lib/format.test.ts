import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MINUS,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPoints,
  formatShareCount,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent,
} from "./format";

test("formatCurrency: dollars with cents, grouped, true minus for negatives", () => {
  assert.equal(formatCurrency(1234.5), "$1,234.50");
  assert.equal(formatCurrency(0), "$0.00");
  assert.equal(formatCurrency(-12.345), `${MINUS}$12.35`);
  assert.equal(formatCurrency(-0.001), "$0.00");
  assert.equal(formatCurrency(Number.NaN), "$0.00");
  assert.equal(formatCurrency(Infinity), "$0.00");
});

test("formatCurrency compact", () => {
  assert.equal(formatCurrency(1500, true), "$1.5K");
  assert.equal(formatCurrency(2_400_000, true), "$2.4M");
  assert.equal(formatCurrency(-1500, true), `${MINUS}$1.5K`);
});

test("formatSignedCurrency always signs non-zero amounts", () => {
  assert.equal(formatSignedCurrency(12.5), "+$12.50");
  assert.equal(formatSignedCurrency(-3), `${MINUS}$3.00`);
  assert.equal(formatSignedCurrency(0), "$0.00");
  assert.equal(formatSignedCurrency(0.004), "$0.00");
  assert.equal(formatSignedCurrency(Number.NaN), "$0.00");
});

test("formatPercent: fixed decimals, optional plus, minus always shown", () => {
  assert.equal(formatPercent(12.345), "12.35%");
  assert.equal(formatPercent(-0.85), `${MINUS}0.85%`);
  assert.equal(formatPercent(1.2, true), "+1.20%");
  assert.equal(formatPercent(1.2, false), "1.20%");
  assert.equal(formatPercent(42.4, false, 0), "42%");
  assert.equal(formatPercent(-3.04, true, 1), `${MINUS}3.0%`);
  assert.equal(formatPercent(-0.001, true), "0.00%");
  assert.equal(formatPercent(Number.NaN), "0.00%");
  assert.equal(formatPercent(Number.NaN, true, 1), "0.0%");
  assert.equal(formatPercent(5, false, 99), "5.00%");
});

test("formatSignedPercent and formatPoints", () => {
  assert.equal(formatSignedPercent(2), "+2.00%");
  assert.equal(formatSignedPercent(-2, 1), `${MINUS}2.0%`);
  assert.equal(formatPoints(1.234), "+1.23 pts");
  assert.equal(formatPoints(-0.5), `${MINUS}0.50 pts`);
  assert.equal(formatPoints(0), "0.00 pts");
});

test("formatNumber / formatShares: grouped, up to 4 decimals", () => {
  assert.equal(formatNumber(1234.56789), "1,234.5679");
  assert.equal(formatShares(10), "10");
  assert.equal(formatShares(0.5), "0.5");
  assert.equal(formatNumber(-2.5), `${MINUS}2.5`);
  assert.equal(formatNumber(Number.NaN), "0");
});

test("formatShareCount pluralizes", () => {
  assert.equal(formatShareCount(1), "1 share");
  assert.equal(formatShareCount(2.5), "2.5 shares");
  assert.equal(formatShareCount(1000), "1,000 shares");
  assert.equal(formatShareCount(Number.NaN), "0 shares");
});

test("Start fresh wording: whole dollars, no .00, and says when it was rounded", async () => {
  const { freshStartWording, formatWholeDollars } = await import("./format");
  assert.equal(formatWholeDollars(47_079), "$47,079");
  const w = freshStartWording(47_079, 47_079.49);
  assert.equal(w.cash, "$47,079");
  assert.equal(w.rounded, true);
  assert.equal(w.phrase, "about $47,079 in cash (today's account value, rounded)");
  assert.doesNotMatch(w.phrase, /\.00/);
  assert.equal(freshStartWording(25_000, 25_000).phrase, "$25,000 in cash (today's account value)");
});
