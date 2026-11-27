import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { HelpChatLauncher } from "@/components/help-chat";
import { GITHUB_ISSUES_URL } from "@/lib/feedback";
import { FAQS } from "@/lib/support-faq";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata: Metadata = {
  title: "Help & support",
  description: "Get help with Sentia, the paper-trading practice app: frequently asked questions, the Help chat, and how to contact support@sentiacoach.com.",
};

export default function SupportPage() {
  return (
    <LegalPage eyebrow="Help" title="Help & support" updated="November 26, 2026">
      <section className="stack gap-sm" aria-labelledby="contact-heading">
        <h2 id="contact-heading">Contact us</h2>
        <ul className="muted">
          <li>
            <strong>Email:</strong> <a href={supportMailto("Sentia support")}>{SUPPORT_EMAIL}</a>. We aim to reply within 3 business days.
          </li>
          <li>
            <strong>Help chat:</strong> tap <strong>Help</strong> in the corner of this page for quick answers, any time.
          </li>
          <li>
            <strong>In the app:</strong> tap <strong>Feedback</strong> in the menu to report a bug or share an idea.
          </li>
          <li>
            <strong>GitHub:</strong>{" "}
            <a href={GITHUB_ISSUES_URL} target="_blank" rel="noreferrer">
              open an issue
            </a>{" "}
            (public, so leave out personal details).
          </li>
        </ul>
        <p className="small muted" style={{ margin: 0 }}>
          We will never ask for your password or a verification code.
        </p>
      </section>

      <section className="stack gap-sm" aria-labelledby="faq-heading">
        <h2 id="faq-heading">Frequently asked questions</h2>
        <div className="faq-list">
          {FAQS.map((f) => (
            <details key={f.id} id={f.id} className="faq-item">
              <summary>
                <span>{f.q}</span>
              </summary>
              <p className="muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="stack gap-sm" aria-labelledby="policies-heading">
        <h2 id="policies-heading">Policies</h2>
        <p className="muted">
          <Link href="/terms">Terms and Conditions</Link> · <Link href="/privacy">Privacy Policy</Link> · <Link href="/disclaimer">Disclaimer</Link> ·{" "}
          <Link href="/delete-account">Delete your data and account</Link>
        </p>
      </section>
      <HelpChatLauncher />
    </LegalPage>
  );
}
