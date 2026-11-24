import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Disclaimer",
  description: "Sentia is a paper-trading simulator that uses play money. It is not investment advice and not a brokerage.",
};

export default function DisclaimerPage() {
  return (
    <LegalPage eyebrow="Legal" title="Disclaimer" updated="November 23, 2026">
      <section className="stack gap-sm">
        <h2>Play money only</h2>
        <p className="muted">
          Every balance, trade, gain and loss in Sentia is simulated. There is no real money to deposit, win, lose or cash
          out, and Sentia never connects to a brokerage account.
        </p>
      </section>
      <section className="stack gap-sm">
        <h2>Not investment advice</h2>
        <p className="muted">
          Sentia is educational software for practicing an investing process. Its coach, insights, scores, examples and
          prices are for learning only and are not investment, financial, tax or legal advice, or a recommendation to buy
          or sell any security. Talk to a licensed professional before making real investment decisions.
        </p>
      </section>
      <section className="stack gap-sm">
        <h2>Prices and data</h2>
        <p className="muted">
          Prices may be delayed, simulated or unavailable, and simulated fills don&apos;t reflect real-world costs,
          slippage or liquidity. Past or simulated results don&apos;t predict future returns.
        </p>
      </section>
      <p className="small muted">
        See also the <Link href="/terms">Terms of use</Link> and <Link href="/privacy">Privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
