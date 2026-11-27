import Link from "next/link";
import { ArrowRight, Award, BellRing, ClipboardCheck, Compass, LineChart, Lock, MessageCircle, NotebookPen, Palette, ShieldCheck, Sparkles } from "lucide-react";
import { assetPath } from "@/lib/asset";
import { SiteFooter } from "./site-footer";
import { LandingHeader } from "./landing-header";
import { HelpChatLauncher } from "./help-chat";

import { ACCOUNTS_ENABLED } from "@/lib/account-provider";

const TRUST = [
  {
    icon: LineChart,
    title: "Real paper trading",
    body: "Buy and sell against a cash balance with weighted-average cost basis and realized P/L — a genuine simulation, not a static list.",
  },
  {
    icon: ShieldCheck,
    title: "Validated, versioned data",
    body: "Every write is checked with Zod and stored under a versioned schema with an automatic migration path.",
  },
  {
    icon: Lock,
    title: "Local-first & private",
    body:
      process.env.NEXT_PUBLIC_STATIC_EXPORT === "true" && !ACCOUNTS_ENABLED
        ? "Your portfolio lives in your browser. This demo runs entirely on your device: no server, no tracking, nothing you enter is sent anywhere."
        : "Your portfolio lives in your browser. The market proxy keeps any API key server-side and ships strict security headers.",
  },
];

// "What's inside": real screenshots of the app (public/inside/*.webp, 800x600, regenerated from a
// local build with demo data).
const INSIDE = [
  { img: "guided-session", icon: Compass, title: "Guided first session", body: "A 60-second walkthrough: pick a goal, make your first practice trade, meet the coach." },
  { img: "journal", icon: NotebookPen, title: "Journal & trade reviews", body: "Every buy keeps its plan. After you sell, rate the trade and write down one lesson." },
  { img: "challenges", icon: Award, title: "Challenges & badges", body: "Small goals that build habits, like planning every trade or holding through a dip." },
  { img: "report-card", icon: ClipboardCheck, title: "Weekly report card", body: "A letter grade each Monday: your return vs. the S&P 500, best and worst trade, and one tip." },
  { img: "coach", icon: MessageCircle, title: "Ask Sentia, your AI coach", body: "Ask about your own portfolio in plain English: concentration, cash, biases, winners." },
  { img: "alerts", icon: BellRing, title: "Watchlist & price alerts", body: "Star tickers, set a price, and get a heads-up when a stock gets there." },
  { img: "themes", icon: Palette, title: "Light, dark or system", body: "A calm glass look in dark or light. It can follow your device automatically." },
] as const;

export function Landing() {
  return (
    <main className="landing">
      <div className="hero-grid-bg" style={{ backgroundImage: `url(${assetPath("/hero-grid.svg")})` }} />
      <div className="container" style={{ position: "relative" }}>
        <LandingHeader accounts={ACCOUNTS_ENABLED} />

        <section className="landing-hero stack gap-lg animate-in" style={{ maxWidth: 720 }}>
          <span className="pill pill-primary" style={{ width: "fit-content" }}>
            <Sparkles size={15} /> Invest with process, not impulse
          </span>
          <h1 className="display-xl">
            A calmer way to practice investing — with <span className="text-gradient">a real process</span> behind
            every trade.
          </h1>
          <p className="muted" style={{ fontSize: 18, maxWidth: 620 }}>
            Sentia is a focused, educational paper-trading coach. Simulate buys and sells, write a thesis for every
            position, and get portfolio-aware insights — all with local-first, validated data.
          </p>
          <div className="row wrap gap-md">
            <Link href="/app" className="btn btn-primary">
              Launch the workspace <ArrowRight size={16} />
            </Link>
            <Link href="/app/trade" className="btn">
              Start trading
            </Link>
          </div>
        </section>

        <section className="grid grid-3" style={{ padding: "24px 0 64px" }}>
          {TRUST.map(({ icon: Icon, title, body }) => (
            <div key={title} className="panel trust-card">
              <span className="trust-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <strong>{title}</strong>
              <span className="small muted">{body}</span>
            </div>
          ))}
        </section>

        <section className="stack gap-lg" style={{ padding: "8px 0 72px" }} aria-labelledby="inside-title">
          <div className="stack gap-sm" style={{ maxWidth: 640 }}>
            <span className="eyebrow">What&apos;s inside</span>
            <h2 id="inside-title" className="display-lg" style={{ margin: 0, fontSize: "clamp(1.6rem, 3.5vw, 2.25rem)" }}>
              Everything you need to practice like a pro
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Real screens from the app. Everything runs on play money, so mistakes cost nothing and teach a lot.
            </p>
          </div>
          <div className="inside-grid">
            {INSIDE.map(({ img, icon: Icon, title, body }) => (
              <article key={img} className="panel inside-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="inside-shot"
                  src={assetPath(`/inside/${img}.webp`)}
                  srcSet={`${assetPath(`/inside/${img}-400.webp`)} 400w, ${assetPath(`/inside/${img}-600.webp`)} 600w, ${assetPath(`/inside/${img}.webp`)} 800w`}
                  sizes="(max-width: 700px) calc(100vw - 48px), 360px"
                  alt={`Sentia screen: ${title}`}
                  width={800}
                  height={600}
                  loading="lazy"
                  decoding="async"
                />
                <h3>
                  <Icon size={18} aria-hidden="true" /> {title}
                </h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <div className="row wrap gap-md">
            <Link href="/app" className="btn btn-primary">
              Try it now, free <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <SiteFooter />
      </div>
      <HelpChatLauncher />
    </main>
  );
}
