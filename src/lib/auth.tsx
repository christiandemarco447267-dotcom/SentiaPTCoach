"use client";

import type { User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isFirebaseConfigured } from "./firebase-config";

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
  /** False when NEXT_PUBLIC_FIREBASE_* isn't set: the app runs guest-only, as before. */
  configured: boolean;
  loading: boolean;
  user: User | null;
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
      await flushCloudSave();
    } catch {
      // Best effort: never block sign-out on a failed save.
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
      configured: isFirebaseConfigured,
      loading: snapshot === null,
      user: snapshot?.user ?? null,
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
    [snapshot, guest, refreshUser, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
