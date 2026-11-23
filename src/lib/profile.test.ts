import { test } from "node:test";
import assert from "node:assert/strict";
import { AVATAR_COLORS, avatarInk, contrastRatio, relativeLuminance } from "./profile";

test("relative luminance and contrast follow WCAG", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.ok(Math.abs(relativeLuminance("#ffffff") - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 1e-9);
  assert.equal(relativeLuminance("not a colour"), 0);
});

test("every avatar colour gets initials with at least 4.5:1 contrast", () => {
  for (const c of AVATAR_COLORS) {
    assert.ok(contrastRatio(c, avatarInk(c)) >= 4.5, `${c} → ${avatarInk(c)} = ${contrastRatio(c, avatarInk(c)).toFixed(2)}`);
  }
});

test("dark backgrounds keep white initials", () => {
  assert.equal(avatarInk("#1e1b4b"), "#ffffff");
  assert.equal(avatarInk("#fde68a"), "#0b1020");
});
