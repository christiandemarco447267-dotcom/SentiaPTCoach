import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Sentia (website, Android and iOS apps) handles your data: optional accounts, email verification, cloud save, the AI coach and Help chat, market data, feedback and opt-in usage counts. We don't sell your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy Policy" updated="November 26, 2026">
      <section className="stack gap-sm">
        <h2>The short version</h2>
        <ul className="muted">
          <li>Sentia is a paper-trading practice app. You can use it without an account, and then your data stays on your device.</li>
          <li>If you create an account, we keep only what is needed to run it: your email, a securely hashed password (or your Google / Apple sign-in ID), passkey public keys, and your practice portfolio.</li>
          <li>We don&apos;t sell or rent your data, we don&apos;t show ads, and we don&apos;t use tracking cookies or third-party analytics.</li>
          <li>You can delete your account and everything we store for it at any time.</li>
        </ul>
        <p className="muted">
          This policy covers the Sentia website (sentiacoach.com) and the Sentia apps for Android and iOS (together, &ldquo;Sentia&rdquo;). Sentia is run by
          Christian DeMarco (&ldquo;we&rdquo;, &ldquo;us&rdquo;). Questions: <a href={supportMailto("Privacy question")}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>1. Using Sentia without an account</h2>
        <p className="muted">
          Everything you enter (cash balance, holdings, trades, theses, journal, profile name and preferences) is saved on the device you are using: in your
          browser&apos;s <code>localStorage</code> on the web, or in the app&apos;s private storage on Android and iOS. It is not sent to us. The website also
          keeps an offline copy of the app&apos;s own files so it opens without a connection. Clearing your browser data or uninstalling the app deletes what is on
          that device.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>2. Accounts (optional)</h2>
        <ul className="muted">
          <li>
            <strong>Email and password.</strong> We store your email address, your name if you give one, and your password only as a salted PBKDF2-SHA256 hash
            (we never store or see the password itself).
          </li>
          <li>
            <strong>Email verification.</strong> New email accounts must confirm the address before they can be used. We email a 6-digit code and a one-time link
            that expire after 30 minutes; only hashed copies are stored. Unconfirmed sign-ups are deleted after 7 days.
          </li>
          <li>
            <strong>Password reset.</strong> If you ask, we email a one-time code and link (also hashed, also 30 minutes). Resetting your password signs you out
            everywhere else.
          </li>
          <li>
            <strong>Face ID / Touch ID / passkeys.</strong> If you turn this on, your device creates a passkey. Your face or fingerprint never leaves your device;
            we store only the passkey&apos;s public key, a name for it (like &ldquo;iPhone&rdquo;) and when it was created and last used.
          </li>
          <li>
            <strong>Continue with Google or Apple.</strong> We receive a signed token from Google or Apple with an ID for you, your email (Apple may give a private
            relay address), whether they verified it, and sometimes your name. We use it only to sign you in. If the provider hasn&apos;t verified the email, we
            don&apos;t use it as your account email.
          </li>
          <li>
            <strong>Sessions and &ldquo;Remember me&rdquo;.</strong> When you sign in, your browser keeps a random session token. With Remember me on, it is kept in{" "}
            <code>localStorage</code> for up to 30 days; with it off, in <code>sessionStorage</code> until you close the tab (at most 12 hours). We store only a hash of
            the token. These are not cookies and are not used for tracking.
          </li>
          <li>
            <strong>Cloud save.</strong> While you&apos;re signed in, your practice portfolio is saved to your account automatically so it follows you to other
            devices. If two devices disagree, the older copy is kept as one backup you can restore in Settings.
          </li>
          <li>
            <strong>Security limits.</strong> To stop abuse we keep short-lived counters: failed sign-ins per email (15 minutes), emails sent per address (24
            hours), and requests per network, keyed by a one-way hash of your IP address that changes daily. We don&apos;t store IP addresses.
          </li>
        </ul>
      </section>

      <section className="stack gap-sm">
        <h2>3. Who processes data for us</h2>
        <p className="muted">We use a small number of service providers, only for the purposes below:</p>
        <ul className="muted">
          <li>
            <strong>Cloudflare</strong> runs the Sentia API (api.sentiacoach.com) and stores account and cloud-save data in Cloudflare Workers KV. Like any web
            server, it processes your IP address to deliver requests.
          </li>
          <li>
            <strong>Resend</strong> delivers our account emails (verification and password reset). It receives your email address and the email&apos;s content.
          </li>
          <li>
            <strong>OpenAI</strong> writes answers for Ask Sentia (the AI coach) and for Help chat questions the FAQ can&apos;t answer (see section 4).
          </li>
          <li>
            <strong>Finnhub and Yahoo Finance</strong> provide market prices. They receive only the ticker symbols being looked up, from our server, never your
            identity or holdings.
          </li>
          <li>
            <strong>Google and Apple</strong>, only if you choose to sign in with them, under their own privacy policies.
          </li>
          <li>
            <strong>GitHub Pages</strong> hosts the website&apos;s files and may log standard technical information (such as IP address and browser type) when
            serving pages.
          </li>
        </ul>
      </section>

      <section className="stack gap-sm">
        <h2>4. AI coach and Help chat</h2>
        <ul className="muted">
          <li>
            <strong>Ask Sentia (AI coach).</strong> Quick-question chips and the offline coach run on your device. When you type a question, it is sent with a short
            summary of your paper account (cash and total value, holdings, up to 10 recent trades with mood tags, Bias Radar findings, Discipline Score, thesis
            titles and risks, and your return vs. the S&amp;P 500) through the Sentia API to OpenAI. It never includes your name, email or profile. Your
            conversation is saved only on your device; &ldquo;Clear chat&rdquo; removes it.
          </li>
          <li>
            <strong>Help chat.</strong> Answers from the FAQ are found on your device. If the FAQ has no match, your question (and the last few messages of that
            chat) is sent to OpenAI through the Sentia API, without any portfolio or account data. The chat refuses to send anything that looks like a code or a
            password.
          </li>
          <li>The Sentia API doesn&apos;t store questions or answers. It counts questions per network per day (using the daily-changing IP hash) to limit costs.</li>
        </ul>
      </section>

      <section className="stack gap-sm">
        <h2>5. Feedback and usage counts</h2>
        <ul className="muted">
          <li>
            <strong>Feedback</strong> sends your message, the type (bug, idea or praise), your email only if you type one, and (if the technical-details box is ticked)
            the page, app version, screen size, browser user-agent and whether prices were live. A portfolio summary is included only if you tick that box. Messages
            are kept in Cloudflare Workers KV for up to one year and may be forwarded to a private Discord or Slack channel only we can read.
          </li>
          <li>
            <strong>Anonymous usage counts</strong> are off until you opt in (Settings → Usage statistics). When on, Sentia sends page names and a few named events
            (for example <code>trade_placed</code>), which are added to daily totals. No user ID, device ID, IP address, tickers, amounts or text are kept. Totals are
            kept for about 13 months.
          </li>
        </ul>
      </section>

      <section className="stack gap-sm">
        <h2>6. How long we keep data</h2>
        <ul className="muted">
          <li>Account, passkeys and cloud save: until you delete your account (or we close it under the Terms).</li>
          <li>Unconfirmed sign-ups: deleted after 7 days. Verification and reset codes: 30 minutes. Sessions: 12 hours or 30 days.</li>
          <li>Security counters: 15 minutes to 24 hours. Feedback: up to 1 year. Usage totals: about 13 months.</li>
          <li>Emails we send may also be kept in Resend&apos;s delivery logs under its own retention policy.</li>
        </ul>
      </section>

      <section className="stack gap-sm">
        <h2>7. Deleting your data and your choices</h2>
        <p className="muted">
          <strong>Settings → Delete my data</strong> permanently deletes the data on that device and, if you&apos;re signed in, your account, its passkeys, its cloud
          save and its backup from our servers. You can also follow the steps on <Link href="/delete-account">Delete your data</Link> or email{" "}
          <a href={supportMailto("Delete my Sentia account")}>{SUPPORT_EMAIL}</a>. Use <strong>Export JSON</strong> in Settings first if you want a copy. You can ask
          us to access, correct or delete your information at any time, and depending on where you live you may have further rights under local law; we will honor
          them.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>8. Security</h2>
        <p className="muted">
          Data travels over HTTPS. Passwords, session tokens, codes and links are stored only as hashes. Sign-ins are rate limited and lock after repeated failures.
          No system is perfectly secure, so please use a unique password, keep your devices locked, and use Remember me only on devices you own.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>9. Children</h2>
        <p className="muted">
          Sentia is not for children under 13, and we don&apos;t knowingly collect personal information from them. If you are 13 to 17, please use Sentia only with
          a parent or guardian&apos;s permission. If you believe a child under 13 has created an account, email{" "}
          <a href={supportMailto("Child account")}>{SUPPORT_EMAIL}</a> and we will delete it.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>10. The Android and iOS apps</h2>
        <p className="muted">
          The apps run the same code as the website. They ask for no device permissions beyond internet access (no location, contacts, camera, photos, microphone or
          advertising ID) and include no ad or tracking SDKs. Apple and Google may collect diagnostics about apps you install under their own policies.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>11. Where data is processed</h2>
        <p className="muted">
          Sentia is operated from the United States (Maryland). Our providers may process data in the United States and other countries where they operate.
        </p>
      </section>

      <section className="stack gap-sm">
        <h2>12. Changes and contact</h2>
        <p className="muted">
          If this policy changes, we will update the date at the top and, for significant changes, tell signed-in users in the app or by email. Questions or
          requests: <a href={supportMailto("Privacy question")}>{SUPPORT_EMAIL}</a> or <Link href="/support">Help &amp; support</Link>. See also the{" "}
          <Link href="/terms">Terms and Conditions</Link>.
        </p>
      </section>
    </LegalPage>
  );
}
