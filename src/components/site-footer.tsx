import Link from "next/link";

/** Shared footer for public (marketing / legal) pages. */
export function SiteFooter() {
  return (
    <footer className="site-footer stack gap-sm">
      <nav aria-label="Legal" className="row wrap gap-md small">
        <Link href="/privacy" className="footer-link">
          Privacy
        </Link>
        <Link href="/terms" className="footer-link">
          Terms
        </Link>
        <Link href="/disclaimer" className="footer-link">
          Disclaimer
        </Link>
        <Link href="/support" className="footer-link">
          Support
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
        brokerage. Prices may be delayed or simulated.
      </p>
    </footer>
  );
}

/** Compact legal footer for inside the app (Settings): legal links, the play-money note and the version. */
export function AppLegalFooter({ version }: { version: string }) {
  return (
    <footer className="site-footer app-legal-footer stack gap-sm" aria-label="About Sentia">
      <nav aria-label="Legal" className="row wrap gap-md small">
        <Link href="/terms" className="footer-link">
          Terms
        </Link>
        <Link href="/privacy" className="footer-link">
          Privacy
        </Link>
        <Link href="/disclaimer" className="footer-link">
          Disclaimer
        </Link>
        <Link href="/support" className="footer-link">
          Support
        </Link>
      </nav>
      <p className="disclaimer">
        Not investment advice. Play money only: every trade in Sentia is simulated. Sentia version {version}.
      </p>
    </footer>
  );
}
