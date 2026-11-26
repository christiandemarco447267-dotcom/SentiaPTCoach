import type { Metadata } from "next";
import { SignInEntry } from "@/components/auth/account-entry";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Sentia account.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SignInEntry />;
}
