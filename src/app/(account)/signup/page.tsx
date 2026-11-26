import type { Metadata } from "next";
import { SignUpEntry } from "@/components/auth/account-entry";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a Sentia account to save your paper portfolio across devices.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SignUpEntry />;
}
