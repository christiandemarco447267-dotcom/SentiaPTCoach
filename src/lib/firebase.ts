"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";

// Config + the "accounts enabled" flag live in firebase-config.ts (no SDK import), so code on the
// app's first-load path can check them without pulling the Firebase SDK into the bundle.
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config";
export { accountsEnabledFor, firebaseConfig, isFirebaseConfigured } from "./firebase-config";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function firebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) throw new Error("Firebase is not configured.");
  if (!app) app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}

export function firestore(): Firestore {
  if (!db) {
    const instance = firebaseApp();
    try {
      // Optional schema fields (e.g. holding.thesisId) may be undefined; Firestore rejects those by default.
      db = initializeFirestore(instance, { ignoreUndefinedProperties: true });
    } catch {
      db = getFirestore(instance); // already initialized (e.g. fast refresh)
    }
  }
  return db;
}
