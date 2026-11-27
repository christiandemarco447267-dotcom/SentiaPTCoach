import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata: Metadata = {
  title: "Terms and Conditions",
  description: "The rules for using Sentia, an educational paper-trading app. Play money only. Not investment advice and not a brokerage.",
};

export default function TermsPage() {
  return (
    <LegalPage eyebrow="Legal" title="Terms and Conditions" updated="November 26, 2026">
      <section className="stack gap-sm">
        <h2>1. Agreement</h2>
        <p className="muted">
          These Terms and Conditions (&ldquo;Terms&rdquo;) are an agreement between you and Christian DeMarco, who operates Sentia (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;). &ldquo;Sentia&rdquo; means the website at sentiacoach.com, the Sentia apps for Android and iOS, and the Sentia API. By using Sentia or
          creating an account, you agree to these Terms and to our <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree, please don&apos;t use
          Sentia.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>2. Paper trading only: no real money</h2>
        <p className="muted">
          <strong>Sentia is a simulator.</strong> Every balance, trade, gain and loss is simulated with play money. Nothing can be deposited, withdrawn, won or cashed
          out, there are no in-app purchases, and no real orders are ever placed. Results in Sentia don&apos;t predict how real investments would perform.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>3. Not investment advice</h2>
        <p className="muted">
          Sentia is for education and information only. Nothing in it (insights, scores, the AI coach, the Help chat, examples, lessons or prices) is investment,
          financial, tax or legal advice, or a recommendation to buy, sell or hold any security. You are solely responsible for your own real-world financial
          decisions. Consider talking to a licensed professional before investing.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>4. Not a brokerage</h2>
        <p className="muted">
          Sentia is not a broker-dealer, investment adviser, bank or other financial institution. It does not hold money or securities, execute real trades, or
          connect to any brokerage account.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>5. Market data</h2>
        <p className="muted">
          Prices come from third-party providers (Finnhub, with Yahoo Finance as a fallback) or are simulated and labelled <strong>Demo</strong>. Prices may be
          delayed, incomplete or wrong, and must not be relied on for real trading. Market data is provided &ldquo;as is&rdquo; and may be subject to the
          providers&apos; own terms.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>6. Who can use Sentia</h2>
        <p className="muted">
          You must be at least 13 years old. If you are 13 to 17, you may use Sentia only with the permission of a parent or legal guardian, who agrees to these
          Terms for you. Sentia is not directed at children under 13.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>7. Your account</h2>
        <ul className="muted">
          <li>Accounts are optional and free. Give a real email address you control; new email accounts must confirm the address before they can be used.</li>
          <li>
            Keep your password and devices secure, use &ldquo;Remember me&rdquo; only on devices you own, and tell us at{" "}
            <a href={supportMailto("Account security")}>{SUPPORT_EMAIL}</a> if you think someone else has accessed your account.
          </li>
          <li>You are responsible for what happens under your account. One person per account; don&apos;t share or sell accounts.</li>
          <li>
            If you sign in with Google or Apple, their terms also apply to that sign-in. If you turn on Face ID / Touch ID, your device&apos;s own security settings
            apply.
          </li>
        </ul>
      </section>

      <section className="stack gap-sm">
        <h2>8. Your data and cloud save</h2>
        <p className="muted">
          What you enter in Sentia is yours. Without an account it lives only on your device, and you are responsible for backing it up (Settings → Export JSON).
          With an account, Sentia saves a copy to our servers so it follows you between devices. We work to keep it safe, but cloud save is provided as a
          convenience without a guarantee against loss, so keep your own export of anything important. You can delete your data at any time (see{" "}
          <Link href="/delete-account">Delete your data</Link>). The <Link href="/privacy">Privacy Policy</Link> explains what we collect and why.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>9. AI features</h2>
        <p className="muted">
          Ask Sentia (the AI coach) and the Help chat generate answers automatically. They can be incomplete or wrong, they are educational only, and they can&apos;t
          see or change your account. Don&apos;t rely on them for real financial decisions, and don&apos;t enter passwords, codes or sensitive personal information.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>10. Acceptable use</h2>
        <p className="muted">When using Sentia, please don&apos;t:</p>
        <ul className="muted">
          <li>break the law, or harass, threaten, impersonate or harm anyone;</li>
          <li>post or send unlawful, hateful, sexually explicit or abusive content (including in feedback, league names or the AI features);</li>
          <li>try to get into accounts, systems or data that aren&apos;t yours, or test, scan or probe Sentia&apos;s security without our written permission;</li>
          <li>overload, disrupt or reverse-engineer the service, or get around rate limits, verification or other protections;</li>
          <li>scrape Sentia, or use bots or automated tools to create accounts or send requests, except as the app itself does;</li>
          <li>use Sentia to give others investment advice, run contests for money, or promote securities or schemes;</li>
          <li>try to make the AI features ignore their rules or produce harmful content.</li>
        </ul>
      </section>

      <section className="stack gap-sm">
        <h2>11. Suspension and termination</h2>
        <p className="muted">
          You can stop using Sentia and delete your account at any time in Settings. We may suspend or close an account, or limit access to Sentia, if you break
          these Terms, if we need to protect users or the service, if required by law, or if an email account is never confirmed. Where reasonable we will tell you
          first. We may also change or discontinue Sentia or any feature; if we shut down account services, we will try to give notice so you can export your data.
          Sections that by their nature should survive (for example 3, 4, 13, 14 and 15) continue after termination.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>12. Intellectual property</h2>
        <p className="muted">
          The Sentia name, logo, design and written content are owned by Christian DeMarco and protected by copyright and trademark laws. You may use Sentia for
          your own personal, non-commercial learning. The app&apos;s source code is published separately under the license in its repository (the MIT License),
          which governs use of that code; it does not grant rights to the Sentia name or logo. Third-party names, logos and data belong to their owners. If you send
          feedback or ideas, you let us use them to improve Sentia without owing you anything.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>13. No warranty</h2>
        <p className="muted">
          Sentia is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, express or implied, including fitness for a
          particular purpose, accuracy, and non-infringement. We don&apos;t promise that Sentia will be uninterrupted, error-free or secure, or that data will never
          be lost.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>14. Limitation of liability</h2>
        <p className="muted">
          To the fullest extent the law allows, we are not liable for any indirect, incidental, special, consequential or punitive damages, or for any loss of
          profits, money, data or goodwill, arising from your use of (or inability to use) Sentia, including any real-world decision you make based on it. Our total
          liability for any claim about Sentia is limited to US$50. Some places don&apos;t allow these limits, so they may not fully apply to you.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>15. Governing law and disputes</h2>
        <p className="muted">
          These Terms are governed by the laws of the State of Maryland and applicable federal law of the United States, without regard to conflict-of-law rules.
          Any dispute will be handled in the state or federal courts located in Maryland, and you and we agree to their jurisdiction, unless the law where you live
          gives you the right to bring a claim locally. Before filing a claim, please email us so we can try to resolve it informally.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>16. App stores</h2>
        <p className="muted">
          If you downloaded Sentia from the Apple App Store or Google Play, the store&apos;s terms also apply (for Apple, the Licensed Application End User License
          Agreement). Apple and Google are not responsible for Sentia or its support.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>17. Changes to these Terms</h2>
        <p className="muted">
          We may update these Terms. We will change the date at the top and, for significant changes, tell signed-in users in the app or by email. If you keep using
          Sentia after a change takes effect, you accept the updated Terms.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>18. Contact</h2>
        <p className="muted">
          Questions about these Terms: <a href={supportMailto("Terms question")}>{SUPPORT_EMAIL}</a> or <Link href="/support">Help &amp; support</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
