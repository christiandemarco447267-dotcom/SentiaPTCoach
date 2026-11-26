"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, Fingerprint, ScanFace } from "lucide-react";
import { safeNextPath } from "@/lib/auth-helpers";
import {
  AccountError,
  currentBiometricLabel,
  isPasskeyCancel,
  looksLikeEmail,
  markPasskeyOffered,
  passkeyOffered,
  passwordError,
  passwordStrength,
  platformPasskeyAvailable,
  registerPasskey,
  signInWithPasskey,
  signInWithPassword,
  signUpWithPassword,
  type PublicAccount,
} from "@/lib/sentia-accounts";
import { AuthCard, FormMessage } from "./auth-card";
import { OrDivider, SocialSignIn } from "./social-sign-in";

function nextFromLocation(): string {
  if (typeof window === "undefined") return "/app";
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

function messageOf(e: unknown, fallback = "Something went wrong. Please try again."): string {
  return e instanceof AccountError ? e.message : fallback;
}

/** Is a platform authenticator (Face ID / Touch ID / fingerprint / Windows Hello) usable here? */
function usePlatformPasskey(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void platformPasskeyAvailable().then((ok) => alive && setAvailable(ok));
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

function BiometricIcon({ apple }: { apple: boolean }) {
  return apple ? <ScanFace size={18} aria-hidden="true" /> : <Fingerprint size={18} aria-hidden="true" />;
}

// ---- shared fields ---------------------------------------------------------------------------

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string | null;
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  const errorId = `${id}-error`;
  const describe = [describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input
          id={id}
          className="input"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          maxLength={128}
          aria-invalid={error ? true : undefined}
          aria-describedby={describe}
          spellCheck={false}
          autoCapitalize="none"
        />
        <button type="button" className="password-toggle" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown} aria-controls={id}>
          {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <span id={errorId} className="form-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function RememberMe({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <label className="check-row remember-row" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-hint`} />
      <span>
        Remember me
        <span id={`${id}-hint`} className="small muted remember-hint">
          {checked ? "Stay signed in on this device for 30 days." : "Sign out when you close this tab (or after 12 hours)."}
        </span>
      </span>
    </label>
  );
}

// ---- "Turn on Face ID / Touch ID?" after sign-up or first password sign-in ---------------------

function PasskeyOffer({ account, onDone }: { account: PublicAccount; onDone: () => void }) {
  const label = currentBiometricLabel();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(deviceName());
      markPasskeyOffered(account.id);
      onDone();
    } catch (e) {
      if (!isPasskeyCancel(e)) setError(messageOf(e, `Couldn't turn on ${label.name}. You can try again later in Settings.`));
      setBusy(false);
    }
  };
  return (
    <AuthCard title={`${label.turnOn}?`} subtitle={`Next time, sign in with ${label.name} instead of typing your password.`}>
      <p className="small muted" style={{ margin: 0 }}>
        Your fingerprint or face never leaves this device. Sentia only stores a passkey&apos;s public key. You can turn this off anytime in Settings.
      </p>
      <div className="stack gap-sm">
        <button type="button" className="btn btn-primary" onClick={() => void turnOn()} disabled={busy}>
          <BiometricIcon apple={label.apple} /> {busy ? "Waiting for your device…" : label.turnOn}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            markPasskeyOffered(account.id);
            onDone();
          }}
          disabled={busy}
        >
          Not now
        </button>
      </div>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </AuthCard>
  );
}

export function deviceName(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android device";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

/** After signing in: offer Face ID / Touch ID once per account, then go on to the app. */
function useAfterSignIn(passkeyReady: boolean) {
  const router = useRouter();
  const [offerFor, setOfferFor] = useState<PublicAccount | null>(null);
  const go = () => router.replace(nextFromLocation());
  const finish = (account: PublicAccount) => {
    if (passkeyReady && account.passkeys.length === 0 && !passkeyOffered(account.id)) setOfferFor(account);
    else go();
  };
  return { offerFor, finish, go };
}

// ---- Sign in ---------------------------------------------------------------------------------

export function SentiaSignInForm() {
  const ids = useId();
  const passkeyReady = usePlatformPasskey();
  const label = currentBiometricLabel();
  const { offerFor, finish, go } = useAfterSignIn(passkeyReady);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const rememberRef = useRef(remember);
  useEffect(() => {
    rememberRef.current = remember;
  }, [remember]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  if (offerFor) return <PasskeyOffer account={offerFor} onDone={go} />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!looksLikeEmail(email)) {
      setError("Enter the email address you signed up with.");
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      finish(await signInWithPassword({ email: email.trim(), password, remember }));
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  const passkey = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey(remember);
      go();
    } catch (e) {
      if (!isPasskeyCancel(e)) setError(messageOf(e, `${label.name} sign-in didn't work. Try again, or use your password.`));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      subtitle="Your practice portfolio saves to your account automatically."
      footer={
        <>
          New to Sentia? <Link href="/signup">Create an account</Link> · <Link href="/app">Keep using it without an account</Link>
        </>
      }
    >
      <SocialSignIn remember={() => rememberRef.current} onSignedIn={(a) => finish(a)} onError={setError} disabled={busy} />
      {passkeyReady ? (
        <button type="button" className="btn btn-block biometric-btn" onClick={() => void passkey()} disabled={busy}>
          <BiometricIcon apple={label.apple} /> {label.signIn}
        </button>
      ) : null}
      <OrDivider />
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${ids}-email`}>Email</label>
          <input
            ref={emailRef}
            id={`${ids}-email`}
            className="input"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
        </div>
        <PasswordField id={`${ids}-password`} label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <RememberMe id={`${ids}-remember`} checked={remember} onChange={setRemember} />
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      </form>
    </AuthCard>
  );
}

// ---- Create account ------------------------------------------------------------------------------

export function SentiaSignUpForm() {
  const ids = useId();
  const passkeyReady = usePlatformPasskey();
  const { offerFor, finish, go } = useAfterSignIn(passkeyReady);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [remember, setRemember] = useState(true);
  const rememberRef = useRef(remember);
  useEffect(() => {
    rememberRef.current = remember;
  }, [remember]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (offerFor) return <PasskeyOffer account={offerFor} onDone={go} />;

  const strength = passwordStrength(password);
  const emailError = submitted && !looksLikeEmail(email) ? "Enter a valid email address." : null;
  const pwError = submitted || password.length >= 8 ? (password ? passwordError(password, email) : submitted ? "Choose a password." : null) : null;
  const confirmError = (submitted || confirm.length >= password.length) && confirm && confirm !== password ? "Passwords don't match." : submitted && !confirm ? "Type your password again." : null;
  const termsError = submitted && !accepted ? "Please accept the Terms and Privacy Policy to continue." : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setError(null);
    if (!looksLikeEmail(email) || passwordError(password, email) || confirm !== password || !accepted) {
      const first = document.querySelector<HTMLElement>("[aria-invalid='true']");
      first?.focus();
      return;
    }
    setBusy(true);
    try {
      finish(await signUpWithPassword({ email: email.trim(), password, name: name.trim(), remember }));
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  const strengthId = `${ids}-strength`;
  return (
    <AuthCard
      title="Create your account"
      subtitle="Free. Your practice progress saves automatically and follows you to any device."
      footer={
        <>
          Already have an account? <Link href="/signin">Sign in</Link> · <Link href="/app">Keep using it without an account</Link>
        </>
      }
    >
      <SocialSignIn remember={() => rememberRef.current} onSignedIn={(a) => finish(a)} onError={setError} disabled={busy} />
      <OrDivider />
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${ids}-name`}>
            Name <span className="muted">(optional)</span>
          </label>
          <input id={`${ids}-name`} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-email`}>Email</label>
          <input
            id={`${ids}-email`}
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${ids}-email-error` : undefined}
          />
          {emailError ? (
            <span id={`${ids}-email-error`} className="form-error">
              {emailError}
            </span>
          ) : null}
        </div>
        <PasswordField id={`${ids}-password`} label="Password" value={password} onChange={setPassword} autoComplete="new-password" error={pwError} describedBy={strengthId} />
        <div id={strengthId} className="strength" aria-live="polite">
          <span className="strength-bar" data-score={strength.score} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="small muted">{password ? `Strength: ${strength.label}. ` : ""}At least 8 characters; a longer phrase is stronger.</span>
        </div>
        <PasswordField id={`${ids}-confirm`} label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={confirmError} />
        <RememberMe id={`${ids}-remember`} checked={remember} onChange={setRemember} />
        <div className="field">
          <label className="check-row" htmlFor={`${ids}-terms`}>
            <input
              id={`${ids}-terms`}
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              required
              aria-invalid={termsError ? true : undefined}
              aria-describedby={termsError ? `${ids}-terms-error` : undefined}
            />
            <span>
              I agree to the{" "}
              <Link href="/terms" target="_blank" rel="noopener">
                Terms of use
              </Link>{" "}
              and{" "}
              <Link href="/privacy" target="_blank" rel="noopener">
                Privacy policy
              </Link>
              .
            </span>
          </label>
          {termsError ? (
            <span id={`${ids}-terms-error`} className="form-error">
              {termsError}
            </span>
          ) : null}
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Creating your account…" : "Create account"}
        </button>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <p className="small muted" style={{ margin: 0 }}>
          Anything you&apos;ve already practiced on this device comes with you into the new account.
        </p>
      </form>
    </AuthCard>
  );
}
