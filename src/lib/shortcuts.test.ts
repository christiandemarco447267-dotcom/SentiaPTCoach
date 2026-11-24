import { test } from "node:test";
import assert from "node:assert/strict";
import { isTypingTarget, resolveShortcut, SEQUENCE_TIMEOUT_MS, type TargetLike } from "./shortcuts";

const body: TargetLike = { tagName: "BODY", closest: () => null };
const idle = { pendingG: null };

test("single-key shortcuts", () => {
  assert.deepEqual(resolveShortcut({ key: "/" }, body, idle, 0).action, { kind: "search" });
  assert.deepEqual(resolveShortcut({ key: "?" }, body, idle, 0).action, { kind: "help" });
  assert.deepEqual(resolveShortcut({ key: "b" }, body, idle, 0).action, { kind: "side", side: "buy" });
  assert.deepEqual(resolveShortcut({ key: "B" }, body, idle, 0).action, { kind: "side", side: "buy" });
  assert.deepEqual(resolveShortcut({ key: "s" }, body, idle, 0).action, { kind: "side", side: "sell" });
  assert.equal(resolveShortcut({ key: "x" }, body, idle, 0).action, null);
});

test("G then D/P/T navigates within the timeout", () => {
  const g = resolveShortcut({ key: "g" }, body, idle, 1000);
  assert.equal(g.action, null);
  assert.equal(g.state.pendingG, 1000);
  assert.deepEqual(resolveShortcut({ key: "d" }, body, g.state, 1500).action, { kind: "nav", href: "/app" });
  assert.deepEqual(resolveShortcut({ key: "p" }, body, g.state, 1500).action, { kind: "nav", href: "/app/portfolio" });
  assert.deepEqual(resolveShortcut({ key: "T" }, body, g.state, 1500).action, { kind: "nav", href: "/app/trade" });
});

test("G sequence expires; D alone does nothing, S after an expired G still sells", () => {
  const g = resolveShortcut({ key: "g" }, body, idle, 0).state;
  assert.equal(resolveShortcut({ key: "d" }, body, g, SEQUENCE_TIMEOUT_MS + 1).action, null);
  assert.equal(resolveShortcut({ key: "d" }, body, idle, 0).action, null);
  assert.deepEqual(resolveShortcut({ key: "s" }, body, g, SEQUENCE_TIMEOUT_MS + 1).action, { kind: "side", side: "sell" });
});

test("ignored while typing, with modifiers, on repeat, or inside a dialog", () => {
  const input: TargetLike = { tagName: "INPUT", type: "text", closest: () => null };
  assert.equal(resolveShortcut({ key: "b" }, input, idle, 0).action, null);
  assert.equal(resolveShortcut({ key: "/" }, { tagName: "TEXTAREA" }, idle, 0).action, null);
  assert.equal(resolveShortcut({ key: "s" }, { tagName: "SELECT" }, idle, 0).action, null);
  assert.equal(resolveShortcut({ key: "b" }, { tagName: "DIV", isContentEditable: true }, idle, 0).action, null);
  assert.equal(resolveShortcut({ key: "b", ctrlKey: true }, body, idle, 0).action, null);
  assert.equal(resolveShortcut({ key: "b", metaKey: true }, body, idle, 0).action, null);
  assert.equal(resolveShortcut({ key: "b", altKey: true }, body, idle, 0).action, null);
  assert.equal(resolveShortcut({ key: "b", repeat: true }, body, idle, 0).action, null);
  const inDialog: TargetLike = { tagName: "BUTTON", closest: (sel: string) => (sel.includes("dialog") ? {} : null) };
  assert.equal(resolveShortcut({ key: "b" }, inDialog, idle, 0).action, null);
});

test("checkboxes and buttons are not typing targets; text inputs are", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "range" }), false);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget(null), false);
});
