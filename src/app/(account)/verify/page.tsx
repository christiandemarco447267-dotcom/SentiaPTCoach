import type { Metadata } from "next";
import { VerifyEntry } from "@/components/auth/account-entry";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Confirm your email address to finish creating your Sentia account.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return <VerifyEntry />;
}
