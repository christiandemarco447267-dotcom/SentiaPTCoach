import type { Metadata } from "next";
import { JournalView } from "@/components/journal-view";

export const metadata: Metadata = {
  title: "Trade journal",
  description: "Every paper trade with its plan, mood and lesson, so you can learn from your own decisions.",
};

export default function Page() {
  return <JournalView />;
}
