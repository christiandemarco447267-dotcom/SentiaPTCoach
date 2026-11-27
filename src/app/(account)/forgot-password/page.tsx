import type { Metadata } from "next";
import { ForgotPasswordEntry } from "@/components/auth/account-entry";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Reset your Sentia password.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ForgotPasswordEntry />;
}
