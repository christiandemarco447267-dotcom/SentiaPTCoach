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

