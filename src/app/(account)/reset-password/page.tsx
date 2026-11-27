import type { Metadata } from "next";
import { ResetPasswordEntry } from "@/components/auth/account-entry";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Choose a new password for your Sentia account.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return <ResetPasswordEntry />;
}
