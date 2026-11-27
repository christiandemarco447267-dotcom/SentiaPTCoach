"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Award,
  BookOpenCheck,
  ClipboardList,
  Cloud,
  CloudAlert,
  CloudOff,
  History,
  Home,
  LogIn,
  LogOut,
  Landmark,
  MessageCircle,
  Trophy,
  MonitorSmartphone,
  Lightbulb,
  LineChart,
  Menu,
  Search,
  NotebookPen,
  PieChart,
  Settings,
  Star,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppProvider, hasUnsavedAccountChanges, retryCloudLoad, useApp } from "@/lib/store";
import { AuthGate } from "./auth/auth-gate";
import { assetPath } from "@/lib/asset";
import { initialsOf, avatarInk } from "@/lib/profile";
import { assessState } from "@/lib/experience";
import { isFirebaseConfigured } from "@/lib/firebase-config";
import { NAV_SECTIONS, visibleNav } from "@/lib/nav";
import { DemoPricesBadge, Loading, ToastHost } from "./ui";
import { FeedbackButton } from "./feedback-sheet";
import { NavLegalLinks } from "./site-footer";
import { FoldWatcher } from "./fold-watcher";
import { PageViewTracker } from "./pilot-prompts";
import { openSearchPalette } from "./command-palette";

// Overlays and background watchers aren't needed for first paint: load them after hydration
// so each page's first-load JavaScript stays small.
const OnboardingTour = dynamic(() => import("./onboarding-tour").then((m) => m.OnboardingTour), { ssr: false });
const ProfileSetup = dynamic(() => import("./profile-setup").then((m) => m.ProfileSetup), { ssr: false });
const DisciplineWatcher = dynamic(() => import("./discipline-card").then((m) => m.DisciplineWatcher), { ssr: false });
const ReportCardWatcher = dynamic(() => import("./report-card-view").then((m) => m.ReportCardWatcher), { ssr: false });
const ChallengeWatcher = dynamic(() => import("./challenges-view").then((m) => m.ChallengeWatcher), { ssr: false });
const PushAlertSync = dynamic(() => import("./settings-extras").then((m) => m.PushAlertSync), { ssr: false });
const AnalyticsNotice = dynamic(() => import("./pilot-prompts").then((m) => m.AnalyticsNotice), { ssr: false });
const MicroSurvey = dynamic(() => import("./pilot-prompts").then((m) => m.MicroSurvey), { ssr: false });
const KeyboardShortcuts = dynamic(() => import("./keyboard-shortcuts").then((m) => m.KeyboardShortcuts), { ssr: false });

// Icons per page; the list itself (and the Leagues rule) lives in lib/nav so the "/" palette shares it.
const NAV_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  "/app": Home,
  "/app/portfolio": Wallet,
  "/app/trade": ArrowLeftRight,
  "/app/markets": LineChart,
  "/app/watchlist": Star,
  "/app/allocate": PieChart,
  "/app/thesis": NotebookPen,
  "/app/insights": Lightbulb,
  "/app/report-card": ClipboardList,
  "/app/journal": BookOpenCheck,
  "/app/coach": MessageCircle,
  "/app/legends": Landmark,
  "/app/time-machine": History,
  "/app/challenges": Award,
  "/app/leagues": Trophy,
  "/app/settings": Settings,
};

// Leagues need accounts; guest-only builds hide it from the nav (the page still explains why if opened directly).
const NAV = visibleNav(isFirebaseConfigured);
const SECTIONS = NAV_SECTIONS;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`));
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useIsActive();
  return (
    <nav aria-label="Main" className="stack" style={{ gap: 6 }}>
      {SECTIONS.map((section) => (
        <div key={section} role="group" aria-labelledby={`nav-section-${section}`}>
          <div className="nav-section" id={`nav-section-${section}`}>
            {section}
          </div>
          {NAV.filter((item) => item.section === section).map(({ href, label }) => {
            const Icon = NAV_ICONS[href] ?? Home;
            return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={clsx("nav-link", isActive(href) && "active")}
              aria-current={isActive(href) ? "page" : undefined}
            >
              <Icon size={18} />
              {label}
            </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function BrandMark({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" className="brand" onClick={onClick} aria-label="Sentia home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetPath("/brand-mark.webp")} alt="" className="brand-mark" width={36} height={36} decoding="async" />
      Sentia
    </Link>
  );
}

function ProfileChip({ onNavigate }: { onNavigate?: () => void }) {
  const { state } = useApp();
  const name = state?.profileName ?? "";
  const initials = initialsOf(name);
  const color = state?.profile.avatarColor || "#0d9488";
  const level = state ? assessState(state) : null;
  const subtitle = level?.answered ? `${level.label} level` : "Tap to personalize";
  return (
    <Link href="/app/settings" onClick={onNavigate} className="profile-chip" style={{ marginTop: onNavigate ? "auto" : 0 }}>
      <span className="avatar" style={{ background: color, color: avatarInk(color) }}>
        {initials || <UserRound size={18} />}
      </span>
      <span className="stack" style={{ gap: 0, minWidth: 0 }}>
        <strong className="truncate">{name || "Set up profile"}</strong>
        <span className="small muted truncate">{subtitle}</span>
      </span>
    </Link>
  );
}

/** Where the paper account is saved: the signed-in account (cloud) or this device (guest/demo). */
function SyncBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { sync } = useApp();
  const { configured, provider } = useAuth();
  if (!configured || !sync.mode) return null;
  if (sync.mode === "guest") {
    if (provider === "sentia") {
      return (
        <Link href="/signin?next=/app" className={clsx("pill", className)} title="Saved on this device only. Sign in or create an account to save your progress to the cloud automatically.">
          <LogIn size={13} /> {compact ? "Sign in" : "Sign in to save progress"}
        </Link>
      );
    }
    return (
      <Link href="/signup" className={clsx("pill", className)} title="Demo mode: saved in this browser only. Create an account to sync.">
        <MonitorSmartphone size={13} /> Demo · this device
      </Link>
    );
  }
  const error = sync.status === "error";
  const offline = sync.status === "offline";
  const text = error
    ? "Sync problem"
    : offline
      ? compact
        ? "Offline"
        : "Offline — will save when back online"
      : sync.status === "saving" || sync.status === "loading"
        ? "Saving…"
        : provider === "sentia"
          ? "Saved"
          : "Synced";
  const title = sync.error ?? (offline ? "You're offline. Your changes are kept on this device and will save when you're back online." : "Saved to your account");
  return (
    <Link href="/app/settings" className={clsx("pill", error || offline ? "pill-demo" : "pill-primary", className)} title={title} role="status" aria-live="polite">
      {error ? <CloudAlert size={13} /> : offline ? <CloudOff size={13} /> : <Cloud size={13} />}{" "}
      {/* On small phones the steady "Saved" state is just the cloud icon (still announced). */}
      {compact && !error && !offline && text === "Saved" ? <span className="sr-only">{text}</span> : text}
    </Link>
  );
}

/** Sign in / create account, or who's signed in + Sign out (sidebar and mobile menu). */
function AccountActions({ onNavigate }: { onNavigate?: () => void }) {
  const { provider, signedIn, account, user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  if (provider === "none") return null;
  if (!signedIn) {
    return (
      <div className="account-actions row wrap gap-sm">
        <Link href="/signin?next=/app" className="btn btn-sm" onClick={onNavigate}>
          <LogIn size={15} /> Sign in
        </Link>
        <Link href="/signup" className="btn btn-sm btn-primary" onClick={onNavigate}>
          Create account
        </Link>
      </div>
    );
  }
  const email = account?.email ?? user?.email ?? "";
  const out = async () => {
    if (hasUnsavedAccountChanges() && !confirm("Some recent changes haven't reached your account yet (you may be offline). Sign out anyway? Those changes will be lost.")) return;
    setBusy(true);
    try {
      await signOut();
      onNavigate?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="account-actions stack" style={{ gap: 6 }}>
      {email && !email.endsWith(".invalid") ? (
        <span className="small muted truncate" title={email}>
          Signed in as {email}
        </span>
      ) : null}
      <button type="button" className="btn btn-sm" onClick={() => void out()} disabled={busy} style={{ width: "fit-content" }}>
        <LogOut size={15} /> {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <BrandMark />
      <button type="button" className="nav-link nav-search" onClick={openSearchPalette} aria-label="Search tickers and pages (shortcut: /)">
        <Search size={18} /> Search <kbd className="kbd" aria-hidden="true">/</kbd>
      </button>
      <NavLinks />
      <div className="stack gap-sm" style={{ marginTop: "auto", padding: "0 4px 6px", alignItems: "flex-start" }}>
        <SyncBadge />
        <DemoPricesBadge />
        <FeedbackButton />
        <AccountActions />
      </div>
      <ProfileChip />
      <NavLegalLinks />
    </aside>
  );
}

function MobileTopBar({
  onMenu,
  menuOpen,
  menuButtonRef,
}: {
  onMenu: () => void;
  menuOpen: boolean;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="topbar">
      <BrandMark />
      <span className="grow" />
      <SyncBadge className="pill-compact" compact />
      <DemoPricesBadge className="pill-compact" />
      <button type="button" className="btn btn-icon" onClick={openSearchPalette} aria-label="Search tickers and pages">
        <Search size={20} />
      </button>
      <button
        ref={menuButtonRef}
        type="button"
        className="btn btn-icon"
        onClick={onMenu}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        aria-controls="mobile-drawer"
      >
        <Menu size={20} />
      </button>
    </header>
  );
}

function MobileDrawer({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes; focus moves into the drawer on open, Tab is kept inside it,
  // and focus returns to the menu button on close.
  useEffect(() => {
    if (!open) return;
    const returnTo = returnFocusRef.current;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const focusables = drawerRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  return (
    <div
      className={clsx("drawer-overlay", open && "open")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        ref={drawerRef}
        id="mobile-drawer"
        className={clsx("drawer", open && "open")}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="row between" style={{ marginBottom: 4 }}>
          <BrandMark onClick={onClose} />
          <button ref={closeRef} type="button" className="btn btn-icon" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <NavLinks onNavigate={onClose} />
        <FeedbackButton className="drawer-feedback" onOpen={onClose} />
        <AccountActions onNavigate={onClose} />
        <ProfileChip onNavigate={onClose} />
        <NavLegalLinks onNavigate={onClose} />
      </div>
    </div>
  );
}

/** Blocks the workspace if a signed-in account couldn't be loaded (never shows stale/foreign data). */
function CloudLoadError() {
  const { state, sync } = useApp();
  const { signOut } = useAuth();
  if (state || sync.mode !== "cloud" || sync.status !== "error") return null;
  return (
    <div className="panel stack gap-md" role="alert" style={{ maxWidth: 520 }}>
      <strong>We couldn&apos;t load your account</strong>
      <span className="small muted">{sync.error}</span>
      <div className="row wrap gap-sm">
        <button className="btn btn-primary" onClick={retryCloudLoad}>
          Try again
        </button>
        <button className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const { state, sync } = useApp();
  if (!state && sync.mode === "cloud" && sync.status === "error") return <CloudLoadError />;
  if (!state && sync.mode === "cloud") return <Loading label="Loading your account…" />;
  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <div className="shell">
        <Sidebar />
        <main className="main" id="main-content" tabIndex={-1}>
          <MobileTopBar onMenu={() => setDrawerOpen(true)} menuOpen={drawerOpen} menuButtonRef={menuButtonRef} />
          <ShellBody>{children}</ShellBody>
        </main>
      </div>
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={menuButtonRef} />
      <ProfileSetup />
      <OnboardingTour />
      <ToastHost />
      <KeyboardShortcuts />
      <FoldWatcher />
      <DisciplineWatcher />
      <ReportCardWatcher />
      <ChallengeWatcher />
      <PushAlertSync />
      <PageViewTracker />
      <div className="pilot-stack">
        <AnalyticsNotice />
        <MicroSurvey />
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        {(mode) => (
          <AppProvider mode={mode}>
            <Shell>{children}</Shell>
          </AppProvider>
        )}
      </AuthGate>
    </AuthProvider>
  );
}
