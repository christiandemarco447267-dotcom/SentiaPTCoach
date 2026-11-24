import type { Metadata } from "next";
import { ThesisView } from "@/components/thesis-view";

export const metadata: Metadata = {
  title: "Investment theses",
  description: "Write and track an investment thesis for every position you hold.",
};

export default function ThesisPage() {
  return <ThesisView />;
}
