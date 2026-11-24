import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSegments, foldCssVars, isCoverScreen, isInnerFoldScreen, readSegments } from "./viewport-segments";

test("no segments or one segment → not spanning", () => {
  assert.deepEqual(describeSegments(null), { mode: "none" });
  assert.deepEqual(describeSegments([{ x: 0, y: 0, width: 400, height: 800 }]), { mode: "none" });
});

test("Surface Duo book mode: two 540px panes with a 34px hinge", () => {
  const info = describeSegments([
    { x: 574, y: 0, width: 540, height: 720 },
    { x: 0, y: 0, width: 540, height: 720 },
  ]);
  assert.deepEqual(info, { mode: "horizontal", hingeLeft: 540, hingeWidth: 34, paneWidths: [540, 540] });
  assert.deepEqual(foldCssVars(info), { "--fold-left": "540px", "--fold-gap": "34px" });
});

test("Galaxy Fold book mode: seamless fold (0px hinge)", () => {
  const info = describeSegments([
    { left: 0, top: 0, width: 420, height: 880 },
    { left: 420, top: 0, width: 420, height: 880 },
  ]);
  assert.equal(info.mode, "horizontal");
  if (info.mode === "horizontal") assert.equal(info.hingeWidth, 0);
});

test("tabletop / flip: stacked segments", () => {
  const info = describeSegments([
    { x: 0, y: 0, width: 720, height: 540 },
    { x: 0, y: 574, width: 720, height: 540 },
  ]);
  assert.deepEqual(info, { mode: "vertical", hingeTop: 540, hingeHeight: 34, paneHeights: [540, 540] });
  assert.deepEqual(foldCssVars(info), { "--fold-top": "540px", "--fold-vgap": "34px" });
  assert.deepEqual(foldCssVars({ mode: "none" }), {});
});

test("cover and inner screen size classes", () => {
  assert.equal(isCoverScreen(280), true);
  assert.equal(isCoverScreen(320), true);
  assert.equal(isCoverScreen(390), false);
  assert.equal(isInnerFoldScreen(840, 900), true);
  assert.equal(isInnerFoldScreen(768, 1024), false); // tablet portrait, not near-square
  assert.equal(isInnerFoldScreen(1366, 900), false);
});

test("readSegments prefers the modern API and falls back to the legacy one", () => {
  const seg = [{ x: 0, y: 0, width: 1, height: 1 }, { x: 1, y: 0, width: 1, height: 1 }];
  assert.equal(readSegments({ viewport: { segments: seg } }), seg);
  assert.equal(readSegments({ getWindowSegments: () => seg }), seg);
  assert.equal(readSegments({ viewport: { segments: null } }), null);
  assert.equal(readSegments(undefined), null);
});
