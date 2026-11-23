// Position sizer (pure; unit-tested): risk a fixed share of the account between
// entry and stop. shares = (account × risk%) ÷ (entry − stop), fractional allowed.
// Educational practice math for paper trades — not advice.

export type SizerInput = {
  account: number;
  riskPct: number;
  entry: number;
  stop: number;
  /** Cash available, to flag a size the account can't pay for. */
  cash?: number;
};

export type SizerResult =
  | { ok: false; error: string }
  | {
      ok: true;
      riskAmount: number;
      perShareRisk: number;
      shares: number;
      cost: number;
      pctOfAccount: number;
      /** Cost is above the available cash. */
      exceedsCash: boolean;
      /** Most shares the cash pays for (fractional), when exceedsCash. */
      affordableShares: number | null;
    };

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
/** Fractional shares to 4 decimals, rounded DOWN so the risk is never exceeded. */
export const floorShares = (v: number) => Math.floor(v * 10_000 + 1e-9) / 10_000;

export function positionSize(input: SizerInput): SizerResult {
  const { account, riskPct, entry, stop, cash } = input;
  if (!Number.isFinite(account) || account <= 0) return { ok: false, error: "Enter an account size above $0." };
  if (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 100) return { ok: false, error: "Risk per trade must be between 0% and 100%." };
  if (!Number.isFinite(entry) || entry <= 0) return { ok: false, error: "Enter an entry price above $0." };
  if (!Number.isFinite(stop) || stop <= 0) return { ok: false, error: "Enter a stop price above $0." };
  if (stop >= entry) return { ok: false, error: "For a buy, the stop must be below the entry price." };
  const riskAmount = r2((account * riskPct) / 100);
  const perShareRisk = entry - stop;
  const shares = floorShares(riskAmount / perShareRisk);
  if (shares <= 0) return { ok: false, error: "That risk is smaller than a fraction of one share. Widen the risk or tighten the stop." };
  const cost = r2(shares * entry);
  const exceedsCash = cash !== undefined && Number.isFinite(cash) && cost > cash + 1e-9;
  return {
    ok: true,
    riskAmount,
    perShareRisk: r2(perShareRisk),
    shares,
    cost,
    pctOfAccount: r2((cost / account) * 100),
    exceedsCash,
    affordableShares: exceedsCash && cash !== undefined ? floorShares(Math.max(0, cash) / entry) : null,
  };
}
