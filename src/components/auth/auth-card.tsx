import Link from "next/link";
import type { ReactNode } from "react";
import { assetPath } from "@/lib/asset";
import { ACCOUNT_PROVIDER } from "@/lib/account-provider";
import { AuthLegalFooter } from "../site-footer";

/** Branded, centered card used by the sign-in / sign-up / recovery screens. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="landing status-screen">
      <div className="hero-grid-bg" style={{ backgroundImage: `url(${assetPath("/hero-grid.svg")})` }} />
      <div className="container status-inner stack gap-lg animate-in" style={{ maxWidth: 480 }}>
        <Link href="/" className="brand" style={{ padding: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetPath("/brand-mark.webp")} alt="" className="brand-mark" width={36} height={36} decoding="async" />
          Sentia
        </Link>
        <div className="panel panel-pad-lg stack gap-md">
          <div className="stack" style={{ gap: 4 }}>
            <h1 style={{ margin: 0, fontSize: 26 }}>{title}</h1>
            {subtitle ? <p className="muted" style={{ margin: 0 }}>{subtitle}</p> : null}
          </div>
          {children}
        </div>
        {footer ? <div className="small muted auth-footer-links">{footer}</div> : null}
        <AuthLegalFooter />
      </div>
    </main>
  );
}

export function FormMessage({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <div aria-live="polite">
      <span className={tone === "ok" ? "form-ok" : "form-error"} role={tone === "error" ? "alert" : "status"}>
        {children}
      </span>
    </div>
  );
}

export function NotConfigured() {
  if (ACCOUNT_PROVIDER === "sentia") {
    return (
      <AuthCard title="This link isn't used here" subtitle="Sentia accounts sign in with a password, Face ID / Touch ID, or Google / Apple.">
        <p className="muted small" style={{ margin: 0 }}>
          Forgot your password? Reset it by email. Still stuck? Write to support@sentiacoach.com and we&apos;ll help you get back in.
        </p>
        <Link href="/signin" className="btn btn-primary">
          Back to sign in
        </Link>
        <Link href="/forgot-password" className="btn">
          Reset my password
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Accounts aren't set up" subtitle="This deployment of Sentia has no accounts configured.">
      <p className="muted small" style={{ margin: 0 }}>
        You can still use the full demo workspace — your data stays in this browser.
      </p>
      <Link href="/app" className="btn btn-primary">
        Open the demo workspace
      </Link>
    </AuthCard>
  );
}
