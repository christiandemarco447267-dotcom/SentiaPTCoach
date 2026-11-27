"use client";

import dynamic from "next/dynamic";
import { ACCOUNT_PROVIDER } from "@/lib/account-provider";
import { NotConfigured } from "./auth-card";

// Picks the sign-in / sign-up screens for this build's account provider. Each provider's forms
// load on demand, so the Sentia screens never pull in the Firebase SDK (and vice versa).
const FirebaseSignIn = dynamic(() => import("./sign-in-form").then((m) => m.SignInForm));
const FirebaseSignUp = dynamic(() => import("./sign-up-form").then((m) => m.SignUpForm));
const SentiaSignIn = dynamic(() => import("./sentia-auth-forms").then((m) => m.SentiaSignInForm));
const SentiaSignUp = dynamic(() => import("./sentia-auth-forms").then((m) => m.SentiaSignUpForm));
const FirebaseForgot = dynamic(() => import("./forgot-password-form").then((m) => m.ForgotPasswordForm));
const SentiaForgot = dynamic(() => import("./sentia-verify").then((m) => m.SentiaForgotPassword));
const SentiaVerify = dynamic(() => import("./sentia-verify").then((m) => m.SentiaVerifyLinkPage));
const SentiaReset = dynamic(() => import("./sentia-verify").then((m) => m.SentiaResetLinkPage));

export function SignInEntry() {
  if (ACCOUNT_PROVIDER === "sentia") return <SentiaSignIn />;
  if (ACCOUNT_PROVIDER === "firebase") return <FirebaseSignIn />;
  return <NotConfigured />;
}

export function SignUpEntry() {
  if (ACCOUNT_PROVIDER === "sentia") return <SentiaSignUp />;
  if (ACCOUNT_PROVIDER === "firebase") return <FirebaseSignUp />;
  return <NotConfigured />;
}


export function ForgotPasswordEntry() {
  if (ACCOUNT_PROVIDER === "sentia") return <SentiaForgot />;
  if (ACCOUNT_PROVIDER === "firebase") return <FirebaseForgot />;
  return <NotConfigured />;
}

/** /verify — the "Confirm my email" button in the verification email (Sentia accounts). */
export function VerifyEntry() {
  if (ACCOUNT_PROVIDER === "sentia") return <SentiaVerify />;
  return <NotConfigured />;
}

/** /reset-password — the "Choose a new password" button in the reset email (Sentia accounts). */
export function ResetPasswordEntry() {
  if (ACCOUNT_PROVIDER === "sentia") return <SentiaReset />;
  return <NotConfigured />;
}
