// Which kind of accounts this build offers. Decided at build time from env vars:
//
//   "firebase" — NEXT_PUBLIC_FIREBASE_* is set (and allowed for this target): the original
//                Firebase Auth + Firestore path, unchanged.
//   "sentia"   — no Firebase: accounts served by the Sentia API (the Cloudflare Worker at
//                NEXT_PUBLIC_SENTIA_API_URL, or the built-in api.sentiacoach.com):
//                email + password, Face ID / Touch ID passkeys, Google / Apple sign-in, and
//                per-account cloud auto-save, all served by the Worker.
//   "none"     — NEXT_PUBLIC_SENTIA_ACCOUNTS=off: guest-only, everything stays on the device.
//
// Framework-free (no React / Firebase imports) so the server-rendered landing page and the
// unit tests can use it.

import { isFirebaseConfigured } from "./firebase-config";
import { normalizeApiUrl, SENTIA_COACH_API_URL } from "./api-config";

export type AccountProvider = "firebase" | "sentia" | "none";

export function resolveAccountProvider(env: { firebase: boolean; apiUrl: string | undefined; sentiaAccounts?: string }): AccountProvider {
  if (env.firebase) return "firebase";
  // NEXT_PUBLIC_SENTIA_ACCOUNTS=off hides worker accounts.
  if (env.sentiaAccounts === "off" || env.sentiaAccounts === "false") return "none";
  // The app always has a Sentia API address: NEXT_PUBLIC_SENTIA_API_URL when set, otherwise the
  // built-in https://api.sentiacoach.com (api-config.ts). If the API can't be reached, sign-in
  // shows a "can't reach the server" message and the app keeps working on the device.
  return normalizeApiUrl(env.apiUrl || SENTIA_COACH_API_URL) ? "sentia" : "none";
}

export const ACCOUNT_PROVIDER: AccountProvider = resolveAccountProvider({
  firebase: isFirebaseConfigured,
  apiUrl: process.env.NEXT_PUBLIC_SENTIA_API_URL,
  sentiaAccounts: process.env.NEXT_PUBLIC_SENTIA_ACCOUNTS,
});

export const ACCOUNTS_ENABLED = ACCOUNT_PROVIDER !== "none";

/** "Continue with Google / Apple" are shown only when their client ids are baked into the build (web only). */
export type SocialConfig = { google: string; apple: { servicesId: string; redirectUri: string } | null };

export function resolveSocialConfig(env: { googleClientId?: string; appleServicesId?: string; appleRedirectUri?: string; target?: string }): SocialConfig {
  // In the app-store build Google blocks its web sign-in inside WebViews and Apple's JS popup
  // can't run, so the buttons stay hidden there (see STORE_RELEASE.md → native sign-in plugins).
  if (env.target === "native") return { google: "", apple: null };
  const google = (env.googleClientId ?? "").trim();
  const servicesId = (env.appleServicesId ?? "").trim();
  const redirectUri = (env.appleRedirectUri ?? "").trim();
  const appleOk = Boolean(servicesId && /^https:\/\/[^\s]+$/.test(redirectUri));
  return { google: /^[\w.-]+\.apps\.googleusercontent\.com$/.test(google) ? google : "", apple: appleOk ? { servicesId, redirectUri } : null };
}

export const SOCIAL: SocialConfig =
  ACCOUNT_PROVIDER === "sentia"
    ? resolveSocialConfig({
        googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        appleServicesId: process.env.NEXT_PUBLIC_APPLE_SERVICES_ID,
        appleRedirectUri: process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI,
        target: process.env.NEXT_PUBLIC_APP_TARGET,
      })
    : { google: "", apple: null };
