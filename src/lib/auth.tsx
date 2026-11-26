"use client";

import type { User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isFirebaseConfigured } from "./firebase-config";
import { ACCOUNT_PROVIDER, type AccountProvider } from "./account-provider";
import {
  endSentiaSession,
  getServerSessionSnapshot,
  getSessionSnapshot,
  startSentiaSession,
  subscribeSession,
  type PublicAccount,
} from "./sentia-accounts";
import { forgetAccountOnDevice } from "./account-sync";

// The Firebase SDK (~100 KB+ gzipped) loads on demand, only when accounts are configured,
// so guest/demo visitors never download it.
const loadAuthSdk = () => Promise.all([import("firebase/auth"), import("./firebase")]).then(([sdk, fb]) => ({ sdk, auth: fb.firebaseAuth() }));
import { deactivateStore, flushCloudSave } from "./store";

// ---- Guest (demo) mode flag ------------------------------------------------
// Guests use the local-only workspace; the choice is remembered on this device.

const GUEST_KEY = "sentia.guest";
const guestListeners = new Set<() => void>();

function readGuest(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

function writeGuest(value: boolean) {
  try {
    if (value) localStorage.setItem(GUEST_KEY, "1");
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    // ignore
  }
  for (const l of guestListeners) l();
}

function subscribeGuest(listener: () => void) {
  guestListeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === GUEST_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    guestListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// ---- Auth context -----------------------------------------------------------

type Snapshot = { user: User | null; emailVerified: boolean };

export type AuthApi = {
  /** Which accounts this build offers: Firebase, Sentia (the Worker), or none (guest-only). */
  provider: AccountProvider;
  /** True when this build offers accounts of either kind. False = guest-only, as before. */
  configured: boolean;
  loading: boolean;
  /** The signed-in Firebase user (provider "firebase" only). */
  user: User | null;
  /** The signed-in Sentia account (provider "sentia" only). */
  account: PublicAccount | null;
  /** Signed in with either provider. */
  signedIn: boolean;
  emailVerified: boolean;
  guest: boolean;
  continueAsGuest: () => void;
  leaveGuest: () => void;
  /** Reload the user and refresh the ID token (picks up email verification). Returns emailVerified. */
  refreshUser: () => Promise<boolean>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(isFirebaseConfigured ? null : { user: null, emailVerified: false });
  const guest = useSyncExternalStore(subscribeGuest, readGuest, () => false);
  const sentia = useSyncExternalStore(subscribeSession, getSessionSnapshot, getServerSessionSnapshot);
  const isSentia = ACCOUNT_PROVIDER === "sentia";

  useEffect(() => {
    if (isSentia) startSentiaSession();
  }, [isSentia]);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void loadAuthSdk()
      .then(({ sdk, auth }) => {
        if (cancelled) return;
        // onIdTokenChanged also fires after getIdToken(true), so a refreshed
        // email_verified claim reaches the UI (onAuthStateChanged would not).
        unsubscribe = sdk.onIdTokenChanged(auth, (user) => {
          setSnapshot({ user, emailVerified: Boolean(user?.emailVerified) });
          if (user) writeGuest(false);
        });
      })
      .catch(() => {
        if (!cancelled) setSnapshot({ user: null, emailVerified: false });
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const refreshUser = useCallback(async () => {
    if (!isFirebaseConfigured) return false;
    const { auth } = await loadAuthSdk();
    const user = auth.currentUser;
    if (!user) return false;
    await user.reload();
    const fresh = auth.currentUser;
    if (!fresh) return false;
    await fresh.getIdToken(true);
    setSnapshot({ user: fresh, emailVerified: fresh.emailVerified });
    return fresh.emailVerified;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await Promise.race([flushCloudSave(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    } catch {
      // Best effort: never block sign-out on a failed save.
    }
    if (ACCOUNT_PROVIDER === "sentia") {
      // Keep the cloud copy; take this account's data off the device (guest data stays).
      const uid = getSessionSnapshot().session?.account.id;
      deactivateStore();
      if (uid) {
        const safe = (get: () => Storage) => {
          try {
            return get();
          } catch {
            return null;
          }
        };
        forgetAccountOnDevice(uid, [safe(() => window.localStorage), safe(() => window.sessionStorage)]);
      }
      await endSentiaSession();
      return;
    }
    deactivateStore();
    writeGuest(false);
    if (isFirebaseConfigured) {
      const { sdk, auth } = await loadAuthSdk();
      await sdk.signOut(auth);
    }
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      provider: ACCOUNT_PROVIDER,
      configured: ACCOUNT_PROVIDER !== "none",
      loading: isSentia ? sentia.status === "loading" : snapshot === null,
      user: snapshot?.user ?? null,
      account: isSentia ? (sentia.session?.account ?? null) : null,
      signedIn: isSentia ? Boolean(sentia.session) : Boolean(snapshot?.user),
      emailVerified: snapshot?.emailVerified ?? false,
      guest,
      continueAsGuest: () => writeGuest(true),
      leaveGuest: () => {
        deactivateStore();
        writeGuest(false);
      },
      refreshUser,
      signOut,
    }),
    [snapshot, guest, refreshUser, signOut, sentia, isSentia],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
