"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { assetPath } from "@/lib/asset";

/**
 * Landing page header: logo + wordmark on the left. Wide screens get small inline buttons
 * (Sign in · Create account · Open app); phones get a compact "Open app" pill plus a menu button
 * that opens a small dropdown (Esc / outside tap / link tap close it; focus stays inside while open
 * and returns to the button after).
 */
export function LandingHeader({ accounts }: { accounts: boolean }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      // Return focus to the menu button only when the menu was actually open.
      if (wasOpen.current) buttonRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [buttonRef.current, ...panelRef.current.querySelectorAll<HTMLElement>("a[href]")].filter(Boolean) as HTMLElement[];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Close if the screen grows past the phone breakpoint while open.
    const wide = window.matchMedia("(min-width: 641px)");
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="landing-header">
      <Link href="/" className="brand landing-brand" aria-label="Sentia home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetPath("/brand-mark.webp")} alt="" className="brand-mark" width={36} height={36} decoding="async" />
        <span>Sentia</span>
      </Link>

      <nav className="landing-nav-wide" aria-label="Account">
        {accounts ? (
          <>
            <Link href="/signin" className="btn btn-sm btn-quiet">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-sm btn-primary">
              Create account
            </Link>
          </>
        ) : null}
        <Link href="/app" className="btn btn-sm">
          Open app <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </nav>

      <div className="landing-nav-compact" ref={wrapRef}>
        <Link href="/app" className="btn btn-sm landing-open-pill">
          Open app
        </Link>
        <button
          ref={buttonRef}
          type="button"
          className="btn btn-icon landing-menu-btn"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
        <div ref={panelRef} id={menuId} className="landing-menu" data-open={open ? "true" : "false"} hidden={!open}>
          <nav aria-label="Site menu" className="landing-menu-list">
            {accounts ? (
              <>
                <Link href="/signin" className="landing-menu-item" onClick={close}>
                  Sign in
                </Link>
                <Link href="/signup" className="landing-menu-item landing-menu-primary" onClick={close}>
                  Create account
                </Link>
              </>
            ) : null}
            <Link href="/app" className="landing-menu-item" onClick={close}>
              Open app <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <span className="landing-menu-sep" role="presentation" />
            <Link href="/support" className="landing-menu-item landing-menu-minor" onClick={close}>
              Help &amp; support
            </Link>
            <Link href="/terms" className="landing-menu-item landing-menu-minor" onClick={close}>
              Terms and Conditions
            </Link>
            <Link href="/privacy" className="landing-menu-item landing-menu-minor" onClick={close}>
              Privacy Policy
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
