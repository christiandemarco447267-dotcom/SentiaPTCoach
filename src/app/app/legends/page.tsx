import type { Metadata } from "next";
import { LegendsView } from "@/components/legends-view";

export const metadata: Metadata = {
  title: "Legend portfolios",
  description: "Explore model portfolios inspired by famous investors and compare them with your own.",
};

export default function Page() {
  return <LegendsView />;
}
