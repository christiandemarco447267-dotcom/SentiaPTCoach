import Link from "next/link";
import { copyrightLine, SUPPORT_EMAIL, supportMailto } from "@/lib/support";

function Copyright({ className }: { className?: string }) {
  return <p className={className ? `copyright ${className}` : "copyright"}>{copyrightLine()}</p>;
}

/** Shared footer for public (marketing / legal) pages. */
export function SiteFooter() {
  return (
    <footer className="site-footer stack gap-sm">
      <nav aria-label="Legal" className="row wrap gap-md small">
        <Link href="/terms" className="footer-link">
          Terms and Conditions
        </Link>
        <Link href="/privacy" className="footer-link">
          Privacy Policy
        </Link>
        <Link href="/disclaimer" className="footer-link">
          Disclaimer
        </Link>
        <Link href="/support" className="footer-link">
          Help &amp; support
        </Link>
        <Link href="/delete-account" className="footer-link">
          Delete your data
        </Link>
        <Link href="/app" className="footer-link">
          Open app
        </Link>
      </nav>
      <p className="disclaimer">
        Sentia is educational paper-trading software that uses play money. It is not investment advice and not a
        brokerage. Prices may be delayed or simulated. Questions?{" "}
        <a href={supportMailto()} className="footer-link">
          {SUPPORT_EMAIL}
        </a>
      </p>
      <Copyright />
    </footer>
  );
}

/** Compact legal footer for inside the app (Settings): legal links, the play-money note, version and copyright. */
export function AppLegalFooter({ version }: { version: string }) {
  return (
    <footer className="site-footer app-legal-footer stack gap-sm" aria-label="About Sentia">
      <nav aria-label="Legal" className="row wrap gap-md small">
        <Link href="/terms" className="footer-link">
          Terms and Conditions
        </Link>
        <Link href="/privacy" className="footer-link">
          Privacy Policy
        </Link>
        <Link href="/disclaimer" className="footer-link">
          Disclaimer
        </Link>
        <Link href="/support" className="footer-link">
          Help &amp; support
        </Link>
      </nav>
      <p className="disclaimer">
        Not investment advice. Play money only: every trade in Sentia is simulated. Sentia version {version}. Support:{" "}
        <a href={supportMailto()} className="footer-link">
          {SUPPORT_EMAIL}
        </a>
      </p>
      <Copyright />
    </footer>
  );
}

/** One-line footer under the sign-in / create account / verify / reset screens. */
export function AuthLegalFooter() {
  return (
    <nav className="auth-legal-footer small" aria-label="Legal">
      <Link href="/terms" className="footer-link">
        Terms
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/privacy" className="footer-link">
        Privacy
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/support" className="footer-link">
        Help
      </Link>
      <span className="auth-legal-copy">{copyrightLine()}</span>
    </nav>
  );
}

/** Tiny legal links at the bottom of the app's sidebar and phone menu. */
export function NavLegalLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="nav-legal" aria-label="Terms and privacy">
      <Link href="/terms" className="footer-link" onClick={onNavigate}>
        Terms
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/privacy" className="footer-link" onClick={onNavigate}>
        Privacy
      </Link>
      <span className="nav-legal-copy">© {new Date().getFullYear()} Sentia</span>
    </nav>
  );
}
