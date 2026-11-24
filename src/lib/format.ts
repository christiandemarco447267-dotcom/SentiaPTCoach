// Shared number formatting for the whole app. One style everywhere:
//   money   → $1,234.56   (negatives "−$1,234.56" with a true minus sign; compact "$1.2K")
//   percent → 12.34%      (signed "+1.20%" / "−0.85%"; whole-number "12%" where precision is noise)
//   shares  → 1,234.5678  (up to 4 decimals, grouped; "1 share" / "2.5 shares" with units)
//   points  → +1.23 pts   (percentage-point differences, e.g. you vs. the S&P 500)
// Non-finite input (NaN, Infinity) never leaks into the UI: it formats as zero.

/** Typographic minus sign (U+2212): lines up with "+" and reads better than a hyphen. */
export const MINUS = "\u2212";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

export function formatCurrency(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "$0.00";
  const abs = Math.abs(value);
  const body = compact ? compactCurrencyFormatter.format(abs) : currencyFormatter.format(abs);
  // Rounds to zero (e.g. −0.001) → no sign.
  return value < 0 && body !== "$0.00" && body !== "$0" ? `${MINUS}${body}` : body;
}

/** Whole-dollar money with no cents: "$47,079". */
export function formatWholeDollars(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const body = `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
  return value < 0 && body !== "$0" ? `${MINUS}${body}` : body;
}

/**
 * Honest wording for the Start fresh amount: whole dollars, and "about … (rounded)"
 * when it was rounded from a live total with cents.
 */
export function freshStartWording(amount: number, accountTotal?: number): { cash: string; rounded: boolean; phrase: string } {
  const cash = formatWholeDollars(amount);
  const rounded = accountTotal !== undefined && Number.isFinite(accountTotal) && Math.abs(accountTotal - amount) >= 0.005;
  return {
    cash,
    rounded,
    phrase:
      accountTotal === undefined || !Number.isFinite(accountTotal)
        ? `${cash} in cash`
        : rounded
          ? `about ${cash} in cash (today's account value, rounded)`
          : `${cash} in cash (today's account value)`,
  };
}

/** Signed money: "+$12.50", "−$3.00", "$0.00". */
export function formatSignedCurrency(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  const body = formatCurrency(Math.abs(value));
  if (body === "$0.00") return body;
  return `${value > 0 ? "+" : MINUS}${body}`;
}

/**
 * Percent with a fixed number of decimals (default 2). `withSign` adds "+" to positives;
 * negatives always show a minus. A value that rounds to zero is shown unsigned ("0.00%").
 */
export function formatPercent(value: number, withSign = false, digits = 2): string {
  const d = clampDigits(digits);
  if (!Number.isFinite(value)) return `${(0).toFixed(d)}%`;
  const body = Math.abs(value).toFixed(d);
  const isZero = Number(body) === 0;
  const sign = isZero ? "" : value < 0 ? MINUS : withSign ? "+" : "";
  return `${sign}${body}%`;
}

/** Signed percent ("+1.20%", "−0.85%"): shorthand for formatPercent(value, true, digits). */
export function formatSignedPercent(value: number, digits = 2): string {
  return formatPercent(value, true, digits);
}

/** Percentage-point difference, always signed: "+1.23 pts", "−0.50 pts". */
export function formatPoints(value: number, digits = 2): string {
  const pct = formatPercent(value, true, digits);
  return `${pct.slice(0, -1)} pts`;
}

/** Plain number, grouped, up to 4 decimals ("1,234.5678"). Negatives use a true minus. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const body = numberFormatter.format(Math.abs(value));
  return value < 0 && body !== "0" ? `${MINUS}${body}` : body;
}

/** Share quantity: grouped, up to 4 decimals (fractional shares), no trailing zeros. */
export function formatShares(value: number): string {
  return formatNumber(value);
}

/** Share quantity with its unit: "1 share", "2.5 shares", "1,000 shares". */
export function formatShareCount(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `${formatShares(n)} ${Math.abs(n) === 1 ? "share" : "shares"}`;
}

function clampDigits(digits: number): number {
  return Number.isInteger(digits) && digits >= 0 && digits <= 6 ? digits : 2;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatRelativeDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const today = startOfLocalDay(new Date());
  const then = startOfLocalDay(date);
  const diffDays = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(iso);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * A Title-case label used mid-sentence: lowercases the first letter of ordinary
 * words but keeps acronyms ("FOMO buy" stays "FOMO buy", "Revenge trade" → "revenge trade").
 */
export function inSentence(label: string): string {
  return label
    .split(" ")
    .map((w) => (/^[A-Z0-9&]{2,}$/.test(w.replace(/[^A-Za-z0-9&]/g, "")) ? w : w.charAt(0).toLowerCase() + w.slice(1)))
    .join(" ");
}
