// Desktop keyboard shortcuts (pure logic; the component wires it to window keydown).
//   /        search palette        B   buy          S   sell
//   G then D dashboard   G then P portfolio   G then T trade   G then W watchlist   G then C coach
//   ?        shortcuts help sheet
// Shortcuts never fire while typing in a field, with Ctrl/⌘/Alt held, or inside an open dialog.

export type ShortcutAction =
  | { kind: "search" }
  | { kind: "side"; side: "buy" | "sell" }
  | { kind: "nav"; href: string }
  | { kind: "help" };

export type ShortcutState = { pendingG: number | null };

export const SEQUENCE_TIMEOUT_MS = 1200;

export const NAV_TARGETS: Record<string, { href: string; label: string }> = {
  d: { href: "/app", label: "Dashboard" },
  p: { href: "/app/portfolio", label: "Portfolio" },
  t: { href: "/app/trade", label: "Trade" },
  w: { href: "/app/watchlist", label: "Watchlist" },
  c: { href: "/app/coach", label: "Ask Sentia (coach)" },
};

export const SHORTCUT_HELP: Array<{ keys: string[]; label: string }> = [
  { keys: ["/"], label: "Search tickers and pages" },
  { keys: ["B"], label: "Buy (opens Trade on the Buy side)" },
  { keys: ["S"], label: "Sell (opens Trade on the Sell side)" },
  { keys: ["G", "D"], label: "Go to Dashboard" },
  { keys: ["G", "P"], label: "Go to Portfolio" },
  { keys: ["G", "T"], label: "Go to Trade" },
  { keys: ["G", "W"], label: "Go to Watchlist" },
  { keys: ["G", "C"], label: "Go to Ask Sentia (coach)" },
  { keys: ["?"], label: "Show this list" },
  { keys: ["Esc"], label: "Close a dialog or this list" },
];

export type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
};

export type TargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
  closest?: (selector: string) => unknown;
} | null;

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "number", "password", "tel", "url", "date", "datetime-local", "month", "time", "week"]);

/** True when the key press belongs to a text field (or anything editable), so shortcuts stay out of the way. */
export function isTypingTarget(target: TargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((target.type ?? "").toLowerCase());
  if (typeof target.closest === "function" && target.closest('[contenteditable=""],[contenteditable="true"],[role="textbox"],[role="combobox"]')) return true;
  return false;
}

/** True when focus is inside an open modal (shortcuts would act behind it). */
export function isInDialog(target: TargetLike): boolean {
  return Boolean(target && typeof target.closest === "function" && target.closest('[role="dialog"]'));
}

/**
 * Resolve one key press. Returns the action to run (or null) and the next sequence state.
 * Pure: `now` is passed in so "G then D" timing is testable.
 */
export function resolveShortcut(
  event: KeyLike,
  target: TargetLike,
  state: ShortcutState,
  now: number,
): { action: ShortcutAction | null; state: ShortcutState } {
  const idle: ShortcutState = { pendingG: null };
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return { action: null, state: idle };
  if (isTypingTarget(target) || isInDialog(target)) return { action: null, state: idle };

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const gActive = state.pendingG !== null && now - state.pendingG <= SEQUENCE_TIMEOUT_MS;

  if (gActive) {
    const nav = NAV_TARGETS[key];
    if (nav) return { action: { kind: "nav", href: nav.href }, state: idle };
    // Any other key cancels the sequence (and is then treated on its own below).
  }
  if (key === "g") return { action: null, state: { pendingG: now } };
  if (key === "/") return { action: { kind: "search" }, state: idle };
  if (key === "?") return { action: { kind: "help" }, state: idle };
  if (key === "b") return { action: { kind: "side", side: "buy" }, state: idle };
  if (key === "s") return { action: { kind: "side", side: "sell" }, state: idle };
  return { action: null, state: idle };
}

/** Event the Trade page listens for to switch sides without a navigation. */
export const TRADE_SIDE_EVENT = "sentia:trade-side";
