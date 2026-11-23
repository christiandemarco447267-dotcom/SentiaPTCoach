// CSV export of the trade ledger and current holdings (pure; unit-tested).
// RFC 4180 quoting, CRLF line endings, and spreadsheet formula-injection guarding
// on free-text cells (a leading = + - @ is prefixed with an apostrophe).
import type { PortfolioSummary } from "./portfolio";
import type { AppState, Transaction } from "./types";

type Cell = string | number | boolean | null | undefined;

/** Quote one cell. Text that a spreadsheet would run as a formula is neutralised. */
export function csvCell(value: Cell, text = false): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  if (text && typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][], textColumns: Set<number> = new Set()): string {
  const lines = [header.map((h) => csvCell(h)).join(",")];
  for (const row of rows) lines.push(row.map((c, i) => csvCell(c, textColumns.has(i))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

const TRADE_HEADER = [
  "date",
  "type",
  "symbol",
  "shares",
  "price",
  "amount",
  "realized_gain",
  "cash_after",
  "mood",
  "note",
  "plan_why",
  "plan_exit",
  "plan_risk",
  "review_rating",
  "review_lesson",
  "thesis",
];

/** Every ledger entry, oldest first. */
export function transactionsCsv(state: Pick<AppState, "transactions" | "theses">): string {
  const thesisTitle = new Map(state.theses.map((t) => [t.id, t.title]));
  const rows = [...state.transactions]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((tx: Transaction) => [
      tx.createdAt,
      tx.type,
      tx.symbol ?? "",
      tx.shares,
      tx.price,
      tx.amount,
      tx.realizedGain,
      tx.cashAfter,
      tx.mood ?? "",
      tx.note,
      tx.plan?.why,
      tx.plan?.exit,
      tx.plan?.risk,
      tx.review?.rating,
      tx.review?.lesson,
      tx.thesisId ? (thesisTitle.get(tx.thesisId) ?? "") : "",
    ]);
  // Free-text columns: type…note and plan/review text and thesis title.
  return toCsv(TRADE_HEADER, rows, new Set([2, 8, 9, 10, 11, 14, 15]));
}

const HOLDING_HEADER = ["symbol", "name", "shares", "avg_cost", "price", "market_value", "cost_basis", "gain", "gain_pct", "priced"];

/** Current positions at the latest prices, plus a cash row. */
export function holdingsCsv(summary: PortfolioSummary): string {
  const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  const rows: Cell[][] = summary.holdings.map((h) => [
    h.symbol,
    h.name,
    h.shares,
    h.avgCost,
    h.hasQuote ? h.price : "",
    r2(h.marketValue),
    r2(h.costBasis),
    r2(h.gain),
    r2(h.gainPercent),
    h.hasQuote ? "yes" : "no",
  ]);
  rows.push(["CASH", "Cash", "", "", "", r2(summary.cash), r2(summary.cash), 0, 0, "yes"]);
  return toCsv(HOLDING_HEADER, rows, new Set([0, 1]));
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
  // BOM so Excel opens UTF-8 (em dashes, names) correctly.
  const blob = new Blob([type.startsWith("text/csv") ? "\ufeff" : "", content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in Safari/Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
