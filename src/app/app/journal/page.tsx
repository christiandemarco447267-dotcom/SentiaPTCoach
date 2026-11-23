import type { Metadata } from "next";
import { JournalView } from "@/components/journal-view";

export const metadata: Metadata = { title: "Trade journal" };

export default function Page() {
  return <JournalView />;
}
