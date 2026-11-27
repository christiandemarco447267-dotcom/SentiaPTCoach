"use client";

// Email verification and password reset screens for Sentia accounts (Cloudflare Worker API):
//   VerifyEmailStep        "Check your email": 6-digit code, Resend with countdown, start over
//   SentiaVerifyLinkPage   /verify?token=…  (the button in the email) → confirms and signs in
//   SentiaForgotPassword   /forgot-password → email → code + new password
//   SentiaResetLinkPage    /reset-password?token=… → new password

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import {
  AccountError,
  checkResetLink,
  cleanCode,
  forgetPendingVerification,
  looksLikeEmail,
  passwordError,
  pendingVerification,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  secondsUntil,
  signInWithPassword,
  tokenFromLocation,
  verifyEmail,
  type PublicAccount,
} from "@/lib/sentia-accounts";
import { AuthCard, FormMessage } from "./auth-card";
import { messageOf, PasskeyOffer, PasswordField, RememberMe, useAfterSignIn, usePlatformPasskey } from "./sentia-auth-forms";

/** Ticks once a second until `at`, returning the seconds left (0 = ready). */
function useCountdown(at: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (secondsUntil(at, now) <= 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [at, now]);
  return secondsUntil(at, now);
}

/** One paste-friendly input for a 6-digit code (iOS / Android offer the code from Mail or Messages). */
function CodeField({ id, value, onChange, error, disabled, autoFocus }: { id: string; value: string; onChange: (v: string) => void; error?: string | null; disabled?: boolean; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div className="field">
      <label htmlFor={id}>6-digit code</label>
      <input
        ref={ref}
        id={id}
        className="input code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={11}
        placeholder="000000"
        value={value}
        onChange={(e) => onChange(cleanCode(e.target.value))}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        spellCheck={false}
        autoCapitalize="none"
      />
      {error ? (
        <span id={`${id}-error`} className="form-error" role="alert">
          {error}
        </span>
      ) : (
        <span id={`${id}-hint`} className="small muted">
          The code expires 30 minutes after it was sent.
        </span>
      )}
    </div>
  );
}

function ResendButton({ readyAt, onResend, disabled }: { readyAt: number; onResend: () => void; disabled?: boolean }) {
  const left = useCountdown(readyAt);
  return (
    <button type="button" className="btn btn-sm" onClick={onResend} disabled={disabled || left > 0} aria-live="polite">
      {left > 0 ? `Resend code in ${left}s` : "Resend code"}
    </button>
  );
}

// ---- "Check your email" ----------------------------------------------------------------------

export function VerifyEmailStep({
  email,
  remember: initialRemember,
  notice,
  sendError,
  onVerified,
  onStartOver,
  startOverLabel = "Wrong email? Start over",
  editableEmail = false,
}: {
  email: string;
  remember: boolean;
  notice?: string;
  sendError?: string;
  onVerified: (account: PublicAccount) => void;
  onStartOver: () => void;
  startOverLabel?: string;
  editableEmail?: boolean;
}) {
  const ids = useId();
  const [address, setAddress] = useState(email);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(initialRemember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(sendError ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState(() => pendingVerification()?.resendAt ?? Date.now() + 60_000);
  const lastTried = useRef("");

  const submit = useCallback(
    async (value: string) => {
      if (busy) return;
      if (!looksLikeEmail(address)) {
        setError("Enter the email address you signed up with.");
        return;
      }
      if (value.length !== 6) {
        setError("Enter all 6 digits.");
        return;
      }
      lastTried.current = value;
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        onVerified(await verifyEmail({ email: address.trim(), code: value, remember }));
      } catch (e) {
        setError(messageOf(e));
        setBusy(false);
      }
    },
    [address, busy, onVerified, remember],
  );

  // Paste or autofill of all 6 digits submits right away (once per code).
  useEffect(() => {
    if (code.length === 6 && code !== lastTried.current) {
      const t = window.setTimeout(() => void submit(code), 0);
      return () => window.clearTimeout(t);
    }
  }, [code, submit]);

  const resend = async () => {
    if (!looksLikeEmail(address)) {
      setError("Enter the email address you signed up with.");
      return;
    }
    setError(null);
    setInfo(null);
    try {
      setReadyAt(await resendVerification(address.trim(), remember));
      setCode("");
      lastTried.current = "";
      setInfo(`A new code is on its way to ${address.trim()}. It replaces any earlier code.`);
    } catch (e) {
      const p = pendingVerification();
      if (p) setReadyAt(p.resendAt);
      setError(messageOf(e));
    }
  };

  return (
    <AuthCard title="Check your email" subtitle="Confirm it's really you before we open your account.">
      <div className="verify-hero" aria-hidden="true">
        <MailCheck size={28} />
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {notice ?? `We sent a 6-digit code and a confirmation link to ${email}.`} Enter the code below, or tap the button in the email.
      </p>
      <form
        className="stack gap-md"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        {editableEmail ? (
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
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={254}
            />
          </div>
        ) : null}
        <CodeField id={`${ids}-code`} value={code} onChange={setCode} error={error} disabled={busy} autoFocus={!editableEmail} />
        <RememberMe id={`${ids}-remember`} checked={remember} onChange={setRemember} />
        <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Confirm email"}
        </button>
        {info ? <FormMessage tone="ok">{info}</FormMessage> : null}
      </form>
      <div className="row between wrap gap-sm verify-actions">
        <ResendButton readyAt={readyAt} onResend={() => void resend()} disabled={busy} />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            forgetPendingVerification();
            onStartOver();
          }}
        >
          {startOverLabel}
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Can&apos;t find it? Check your spam or promotions folder. You can resend once a minute, up to 5 times a day.
      </p>
    </AuthCard>
  );
}

// ---- /verify (link in the email) ------------------------------------------------------------

export function SentiaVerifyLinkPage() {
  const router = useRouter();
  const passkeyReady = usePlatformPasskey();
  const { offerFor, finish, go } = useAfterSignIn(passkeyReady);
  const [phase, setPhase] = useState<"loading" | "working" | "failed" | "code">("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ email: string; remember: boolean } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFromLocation(window.location.search, window.location.hash);
    const saved = pendingVerification();
    // Drop the token from the address bar (and history) right away.
    if (token) window.history.replaceState(null, "", window.location.pathname);
    const t = window.setTimeout(() => {
      setPending(saved ? { email: saved.email, remember: saved.remember } : null);
      if (!token) {
        setPhase("code");
        return;
      }
      setPhase("working");
      verifyEmail({ token, remember: saved?.remember ?? false })
        .then((account) => finish(account))
        .catch((e: unknown) => {
          setError(messageOf(e));
          setPhase("failed");
        });
    }, 0);
    return () => window.clearTimeout(t);
  }, [finish]);

  if (offerFor) return <PasskeyOffer account={offerFor} onDone={go} />;

  if (phase === "code") {
    return (
      <VerifyEmailStep
        email={pending?.email ?? ""}
        remember={pending?.remember ?? false}
        editableEmail={!pending}
        notice={pending ? undefined : "Enter the email you signed up with and the 6-digit code from our email."}
        onVerified={finish}
        onStartOver={() => router.replace("/signup")}
      />
    );
  }

  if (phase === "failed") {
    return (
      <AuthCard title="That link didn't work" subtitle={error ?? "This link has expired or was already used."}>
        <p className="muted small" style={{ margin: 0 }}>
          Links work once and expire after 30 minutes. If you already confirmed your email, just sign in. Otherwise sign in with your password and we&apos;ll send you a new code.
        </p>
        <div className="stack gap-sm">
          <Link href="/signin" className="btn btn-primary">
            Sign in
          </Link>
          <button type="button" className="btn" onClick={() => setPhase("code")}>
            I have a code
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Confirming your email…" subtitle="One moment while we check your link.">
      <div className="auth-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" /> Checking your link…
      </div>
    </AuthCard>
  );
}

// ---- Forgot password ----------------------------------------------------------------------------

function NewPasswordFields({ ids, email, password, setPassword, confirm, setConfirm, submitted }: { ids: string; email: string; password: string; setPassword: (v: string) => void; confirm: string; setConfirm: (v: string) => void; submitted: boolean }) {
  const pwError = submitted || password.length >= 8 ? (password ? passwordError(password, email) : submitted ? "Choose a new password." : null) : null;
  const confirmError = (submitted || confirm.length >= password.length) && confirm && confirm !== password ? "Passwords don't match." : submitted && !confirm ? "Type your new password again." : null;
  return (
    <>
      <PasswordField id={`${ids}-new`} label="New password" value={password} onChange={setPassword} autoComplete="new-password" error={pwError} describedBy={`${ids}-new-hint`} />
      <span id={`${ids}-new-hint`} className="small muted" style={{ marginTop: -8 }}>
        At least 8 characters; a longer phrase is stronger.
      </span>
      <PasswordField id={`${ids}-confirm`} label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={confirmError} />
    </>
  );
}

/** After a reset: sign in with the new password and go to the app. */
function useSignInAfterReset() {
  const router = useRouter();
  return async (email: string, password: string, remember: boolean) => {
    try {
      const result = await signInWithPassword({ email, password, remember });
      router.replace("needsVerification" in result ? "/signin" : "/app");
    } catch {
      router.replace("/signin");
    }
  };
}

export function SentiaForgotPassword() {
  const ids = useId();
  const signInAfter = useSignInAfterReset();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState(0);

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (!looksLikeEmail(email)) {
      setError("Enter the email address for your account.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      setReadyAt(await requestPasswordReset(email.trim()));
      setStep("code");
      setInfo(`If an account exists for ${email.trim()}, a code and a reset link are on their way. Check your inbox (and spam).`);
    } catch (e) {
      if (e instanceof AccountError && e.status === 429 && typeof e.body?.retryAfter === "number") setReadyAt(Date.now() + e.body.retryAfter * 1000);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    if (passwordError(password, email) || confirm !== password) return;
    setBusy(true);
    try {
      const account = await resetPassword({ email: email.trim(), code, password });
      setStep("done");
      await signInAfter(account || email.trim(), password, remember);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <AuthCard title="Password updated" subtitle="You're all set. Signing you in…">
        <div className="auth-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Signing you in…
        </div>
      </AuthCard>
    );
  }

  if (step === "code") {
    return (
      <AuthCard title="Enter your code" subtitle="Then choose a new password." footer={<Link href="/signin">Back to sign in</Link>}>
        {info ? <FormMessage tone="ok">{info}</FormMessage> : null}
        <form className="stack gap-md" onSubmit={reset} noValidate>
          <CodeField id={`${ids}-code`} value={code} onChange={setCode} disabled={busy} autoFocus />
          <NewPasswordFields ids={ids} email={email} password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} submitted={submitted} />
          <RememberMe id={`${ids}-remember`} checked={remember} onChange={setRemember} />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save new password"}
          </button>
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        </form>
        <div className="row between wrap gap-sm verify-actions">
          <ResendButton readyAt={readyAt} onResend={() => void send()} disabled={busy} />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
              setInfo(null);
            }}
          >
            Use a different email
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          For your security, saving a new password signs you out on every other device.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your account email and we'll send you a code and a secure link." footer={<Link href="/signin">Back to sign in</Link>}>
      <form className="stack gap-md" onSubmit={send} noValidate>
        <div className="field">
          <label htmlFor={`${ids}-email`}>Email</label>
          <input
            id={`${ids}-email`}
            className="input"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send reset email"}
        </button>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      </form>
    </AuthCard>
  );
}

// ---- /reset-password (link in the email) ----------------------------------------------------------

export function SentiaResetLinkPage() {
  const ids = useId();
  const signInAfter = useSignInAfterReset();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "invalid" | "done">("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = tokenFromLocation(window.location.search, window.location.hash);
    if (t) window.history.replaceState(null, "", window.location.pathname);
    const timer = window.setTimeout(() => {
      setToken(t);
      if (!t) {
        setPhase("invalid");
        return;
      }
      checkResetLink(t)
        .then((ok) => setPhase(ok ? "ready" : "invalid"))
        .catch((e: unknown) => {
          setError(messageOf(e));
          setPhase("invalid");
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !token) return;
    setSubmitted(true);
    setError(null);
    if (passwordError(password, "") || confirm !== password) return;
    setBusy(true);
    try {
      const email = await resetPassword({ token, password });
      setPhase("done");
      await signInAfter(email, password, remember);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
      if (e instanceof AccountError && e.body?.linkInvalid) setPhase("invalid");
    }
  };

  if (phase === "loading" || phase === "done") {
    return (
      <AuthCard title={phase === "done" ? "Password updated" : "Checking your link…"} subtitle={phase === "done" ? "Signing you in…" : "One moment."}>
        <div className="auth-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> {phase === "done" ? "Signing you in…" : "Checking your link…"}
        </div>
      </AuthCard>
    );
  }

  if (phase === "invalid") {
    return (
      <AuthCard title="That link didn't work" subtitle={error ?? "This reset link has expired or was already used."}>
        <p className="muted small" style={{ margin: 0 }}>
          Reset links work once and expire after 30 minutes. Ask for a new one below.
        </p>
        <Link href="/forgot-password" className="btn btn-primary">
          Send a new reset email
        </Link>
        <Link href="/signin" className="btn">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Saving it signs you out on every other device." footer={<Link href="/signin">Back to sign in</Link>}>
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <NewPasswordFields ids={ids} email="" password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} submitted={submitted} />
        <RememberMe id={`${ids}-remember`} checked={remember} onChange={setRemember} />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save new password"}
        </button>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      </form>
    </AuthCard>
  );
}
