"use client";

import { useEffect, useRef, useState } from "react";
import { SOCIAL } from "@/lib/account-provider";
import { AccountError, oauthNonce, signInWithIdToken, type PublicAccount } from "@/lib/sentia-accounts";

// "Continue with Google" uses Google's own rendered button (Google Identity Services), which is
// the brand-compliant way to show it; "Continue with Apple" follows Apple's button guidelines
// (white style on dark backgrounds) and uses Sign in with Apple JS in popup mode, since a static
// site can't receive Apple's form_post redirect. Both hand an ID token to the Worker, which
// checks it against Google's / Apple's published keys.

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
const APPLE_SCRIPT = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

type GoogleId = {
  initialize: (opts: Record<string, unknown>) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
  cancel?: () => void;
};
type AppleAuth = {
  init: (opts: Record<string, unknown>) => void;
  signIn: () => Promise<{ authorization?: { id_token?: string }; user?: { name?: { firstName?: string; lastName?: string } } }>;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
    AppleID?: { auth?: AppleAuth };
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const existing = scripts.get(src);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scripts.delete(src);
      reject(new Error("Couldn't load the sign-in service. Check your connection or content blockers."));
    };
    document.head.appendChild(el);
  });
  scripts.set(src, p);
  return p;
}

export const SOCIAL_ENABLED = Boolean(SOCIAL.google || SOCIAL.apple);

type Props = {
  /** Read at the moment of sign-in, so it follows the Remember me checkbox. */
  remember: () => boolean;
  onSignedIn: (account: PublicAccount, isNew: boolean) => void;
  onError: (message: string | null) => void;
  disabled?: boolean;
};

export function SocialSignIn(props: Props) {
  if (!SOCIAL_ENABLED) return null;
  return (
    <div className="social-stack" aria-label="Sign in with another account" role="group">
      {SOCIAL.apple ? <AppleButton {...props} /> : null}
      {SOCIAL.google ? <GoogleButton {...props} /> : null}
    </div>
  );
}

export function OrDivider() {
  if (!SOCIAL_ENABLED) return null;
  return (
    <div className="or-divider" role="separator" aria-label="or">
      <span aria-hidden="true">or</span>
    </div>
  );
}

function GoogleButton({ remember, onSignedIn, onError }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ remember, onSignedIn, onError });
  useEffect(() => {
    latest.current = { remember, onSignedIn, onError };
  });

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      await loadScript(GOOGLE_SCRIPT);
      const { nonceId, nonce } = await oauthNonce();
      const api = window.google?.accounts?.id;
      if (cancelled || !api || !holder.current) return;
      api.initialize({
        client_id: SOCIAL.google,
        nonce,
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: "popup",
        callback: (resp: { credential?: string }) => {
          if (!resp.credential) return;
          latest.current.onError(null);
          signInWithIdToken({ provider: "google", idToken: resp.credential, nonceId, remember: latest.current.remember() })
            .then((account) => latest.current.onSignedIn(account, Date.now() - Date.parse(account.createdAt) < 60_000))
            .catch((e: unknown) => {
              latest.current.onError(e instanceof AccountError ? e.message : "Google sign-in didn't work. Please try again.");
              void setup().catch(() => undefined); // a fresh nonce for the next try
            });
        },
      });
      const width = Math.max(200, Math.min(400, Math.floor(holder.current.getBoundingClientRect().width || 320)));
      holder.current.replaceChildren();
      api.renderButton(holder.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "center", width });
    };
    setup().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        Google sign-in couldn&apos;t load. Check your connection or content blocker, or use email below.
      </p>
    );
  }
  // Google draws its own button (with the official "G" logo and wording) into this box.
  return <div ref={holder} className="google-btn-holder" style={{ minHeight: 44 }} />;
}

function AppleLogo() {
  return (
    <svg width="16" height="19" viewBox="0 0 814 1000" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 201-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-166 41s-106-58-156-128C44 789 0 671 0 558c0-180 117-276 232-276 61 0 112 40 150 40 37 0 94-43 164-43 26 0 122 3 185 93zM555 159c29-34 49-82 49-129 0-7-1-14-2-19-47 2-103 31-136 71-27 30-52 78-52 126 0 7 1 14 2 17 3 1 8 1 13 1 42 0 95-28 126-67z"
      />
    </svg>
  );
}

/** Load Apple's script, get a one-time nonce from the Sentia API, and initialise Sign in with Apple (popup mode). */
async function prepareApple(): Promise<{ nonceId: string; nonce: string }> {
  await loadScript(APPLE_SCRIPT);
  const n = await oauthNonce();
  const auth = window.AppleID?.auth;
  if (!auth || !SOCIAL.apple) throw new Error("Apple sign-in isn't available.");
  auth.init({ clientId: SOCIAL.apple.servicesId, scope: "name email", redirectURI: SOCIAL.apple.redirectUri, state: n.nonceId.slice(0, 16), nonce: n.nonce, usePopup: true });
  return n;
}

function AppleButton({ remember, onSignedIn, onError, disabled }: Props) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const nonceRef = useRef<{ nonceId: string; nonce: string } | null>(null);

  // Prepare everything ahead of the tap so the popup opens straight from the click (popup blockers).
  const refresh = () =>
    prepareApple()
      .then((n) => {
        nonceRef.current = n;
        setReady(true);
      })
      .catch(() => setReady(false));

  useEffect(() => {
    let cancelled = false;
    prepareApple()
      .then((n) => {
        if (cancelled) return;
        nonceRef.current = n;
        setReady(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const click = async () => {
    const auth = window.AppleID?.auth;
    const n = nonceRef.current;
    if (!auth || !n) {
      onError("Apple sign-in is still loading. Try again in a moment.");
      void refresh();
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const res = await auth.signIn();
      const idToken = res.authorization?.id_token;
      if (!idToken) throw new Error("no token");
      const name = [res.user?.name?.firstName, res.user?.name?.lastName].filter(Boolean).join(" ");
      nonceRef.current = null;
      const account = await signInWithIdToken({ provider: "apple", idToken, nonceId: n.nonceId, remember: remember(), name });
      onSignedIn(account, Date.now() - Date.parse(account.createdAt) < 60_000);
    } catch (e) {
      const code = (e as { error?: string } | null)?.error;
      if (code !== "popup_closed_by_user" && code !== "user_cancelled_authorize") {
        onError(e instanceof AccountError ? e.message : "Apple sign-in didn't work. Please try again.");
      }
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        Apple sign-in couldn&apos;t load. Check your connection or content blocker, or use email below.
      </p>
    );
  }
  return (
    <button type="button" className="apple-btn" onClick={() => void click()} disabled={disabled || busy || !ready} aria-busy={busy || !ready}>
      <AppleLogo />
      <span>{busy ? "Continuing with Apple…" : "Continue with Apple"}</span>
    </button>
  );
}
