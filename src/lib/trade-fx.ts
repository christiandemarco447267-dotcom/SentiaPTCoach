// Small, dependency-free trade feedback: a chip that floats up ("Bought 5 AAPL") and a ring
// pulse on the button that placed the trade. Skipped entirely when the OS asks for reduced
// motion (the inline confirmation text still announces the trade).
import { prefersReducedMotion } from "./celebrate";
import { formatShares } from "./format";

export type TradeSide = "buy" | "sell";

/** Short label for the floating chip: "Bought 5 AAPL", "Sold 0.5 TSLA". */
export function tradeFxLabel(side: TradeSide, shares: number, symbol: string): string {
  return `${side === "buy" ? "Bought" : "Sold"} ${formatShares(shares)} ${symbol.toUpperCase()}`;
}

/** Whether the animation should run (false on the server and with reduced motion). */
export function tradeFxEnabled(reducedMotion: boolean, hasDocument: boolean): boolean {
  return hasDocument && !reducedMotion;
}

const FX_MS = 1300;

export function playTradeFx(side: TradeSide, shares: number, symbol: string, source?: HTMLElement | null) {
  if (!tradeFxEnabled(prefersReducedMotion(), typeof document !== "undefined")) return;
  const chip = document.createElement("div");
  chip.className = `trade-fx trade-fx-${side}`;
  chip.setAttribute("aria-hidden", "true");
  chip.textContent = `${side === "buy" ? "▲" : "▼"} ${tradeFxLabel(side, shares, symbol)}`;
  document.body.appendChild(chip);
  window.setTimeout(() => chip.remove(), FX_MS + 100);
  if (source) {
    const cls = ["fx-pulse", `fx-pulse-${side}`];
    source.classList.remove(...cls);
    // Force a reflow so the animation restarts on back-to-back trades.
    void source.offsetWidth;
    source.classList.add(...cls);
    window.setTimeout(() => source.classList.remove(...cls), 800);
  }
}
