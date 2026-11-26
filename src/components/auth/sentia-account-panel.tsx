"use client";

import { useEffect, useState } from "react";
import { CloudCog, Fingerprint, History, KeyRound, LogOut, ScanFace, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { fetchBackup, type BackupInfo } from "@/lib/account-sync";
import { useAuth } from "@/lib/auth";
import {
  AccountError,
  currentBiometricLabel,
  devicePasskeyId,
  isPasskeyCancel,
  platformPasskeyAvailable,
  registerPasskey,
  removePasskey,
  currentToken,
} from "@/lib/sentia-accounts";
import { hasUnsavedAccountChanges, restoreAccountBackup, useApp } from "@/lib/store";
import { Panel } from "../ui";
import { deviceName } from "./sentia-auth-forms";

const when = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** Settings → Account (Sentia accounts): who's signed in, auto-save status, Face ID / Touch ID, backup copy, sign out. */
export function SentiaAccountPanel() {
  const { account, signOut } = useAuth();
  const { sync } = useApp();
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const label = currentBiometricLabel();

  useEffect(() => {
    let alive = true;
    void platformPasskeyAvailable().then((ok) => alive && setPasskeyReady(ok));
    void fetchBackup(currentToken())
      .then((b) => alive && setBackup(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!account) return null;
  const mine = devicePasskeyId(account.id);
  const onThisDevice = Boolean(mine && account.passkeys.some((p) => p.id === mine));
  const providers = account.providers.map((p) => (p === "google" ? "Google" : "Apple"));
  const methods = [...(account.hasPassword ? ["Password"] : []), ...providers, ...(account.passkeys.length ? [`Passkey${account.passkeys.length > 1 ? "s" : ""}`] : [])];
  const status =
    sync.status === "offline"
      ? "You're offline. Changes are kept on this device and save automatically when you're back online."
      : sync.status === "error"
        ? (sync.error ?? "There's a problem saving. We'll keep trying.")
        : sync.status === "saving" || sync.status === "loading"
          ? "Saving…"
          : "All progress saved to your account. It saves automatically a few seconds after each change.";

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ tone: "ok", text });
    } catch (e) {
      if (!isPasskeyCancel(e)) setMessage({ tone: "error", text: e instanceof AccountError ? e.message : "That didn't work. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const toggleBiometric = () =>
    run(async () => {
      if (onThisDevice && mine) {
        await removePasskey(mine);
        return `${label.name} sign-in is off on this device.`;
      }
      await registerPasskey(deviceName());
      return `${label.name} sign-in is on. Next time, tap “${label.signIn}”.`;
    });

  const restore = () =>
    run(async () => {
      if (!backup?.state) return null;
      if (!confirm(`Switch to the other copy saved ${when(backup.savedAt)}? What you see now becomes the backup, so you can switch back.`)) return null;
      const before = backup;
      await restoreAccountBackup(before.state!);
      setBackup(await fetchBackup(currentToken()).catch(() => null));
      return "Switched to the other copy. It's saving to your account now.";
    });

  const out = () =>
    run(async () => {
      if (hasUnsavedAccountChanges() && !confirm("Some recent changes haven't reached your account yet (you may be offline). Sign out anyway? Those changes will be lost.")) return null;
      await signOut();
      return null;
    });

  const shownEmail = account.email.endsWith(".invalid") ? "(no email shared)" : account.email;

  return (
    <Panel className="stack gap-md">
      <span className="row gap-sm">
        <UserRound size={18} aria-hidden="true" /> <strong id="account-panel-title">Your account</strong>
      </span>
      <div className="stack" style={{ gap: 2 }}>
        <span>
          {account.name ? <strong>{account.name} · </strong> : null}
          <span className="muted">{shownEmail}</span>
        </span>
        <span className="small muted">Sign-in: {methods.join(", ") || "—"}</span>
      </div>

      <div className="row gap-sm" role="status" aria-live="polite">
        <CloudCog size={16} aria-hidden="true" />
        <span className="small">{status}</span>
      </div>

      {passkeyReady ? (
        <div className="row between wrap gap-sm">
          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="row gap-sm">
              {label.apple ? <ScanFace size={16} aria-hidden="true" /> : <Fingerprint size={16} aria-hidden="true" />}
              <strong id="biometric-label">{label.name} on this device</strong>
            </span>
            <span className="small muted">Sign in without your password. Your fingerprint or face never leaves the device.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={onThisDevice}
            aria-labelledby="biometric-label"
            className="switch"
            onClick={() => void toggleBiometric()}
            disabled={busy}
          />
        </div>
      ) : null}

      {account.passkeys.length ? (
        <div className="stack gap-sm">
          <span className="row gap-sm small">
            <KeyRound size={15} aria-hidden="true" /> <strong>Passkeys on your account</strong>
          </span>
          <ul className="passkey-list">
            {account.passkeys.map((p) => (
              <li key={p.id} className="row between wrap gap-sm">
                <span className="small">
                  {p.name}
                  {p.id === mine ? " (this device)" : ""} <span className="muted">· added {when(p.createdAt)}</span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => void run(async () => (await removePasskey(p.id), "Passkey removed."))} disabled={busy} aria-label={`Remove passkey ${p.name}`}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {backup?.exists && backup.state ? (
        <div className="row between wrap gap-sm">
          <span className="stack" style={{ gap: 2 }}>
            <span className="row gap-sm small">
              <History size={15} aria-hidden="true" /> <strong>Other saved copy</strong>
            </span>
            <span className="small muted">
              When two devices disagreed, the newer progress was kept and this copy (last changed {when(backup.updatedAt)}) was saved here, just in case.
            </span>
          </span>
          <button type="button" className="btn btn-sm" onClick={() => void restore()} disabled={busy}>
            Switch to this copy
          </button>
        </div>
      ) : null}

      <div className="row wrap gap-sm">
        <button type="button" className="btn" onClick={() => void out()} disabled={busy}>
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
      </div>
      <span className="small muted row gap-sm">
        <ShieldCheck size={14} aria-hidden="true" /> Signing out keeps your progress in your account and removes it from this device.
      </span>
      {message ? (
        <span className={message.tone === "ok" ? "form-ok" : "form-error"} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </span>
      ) : null}
    </Panel>
  );
}
