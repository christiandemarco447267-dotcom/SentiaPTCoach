import type { Metadata } from "next";
import { InsightsView } from "@/components/insights-view";

export const metadata: Metadata = {
  title: "Insights",
  description: "Your Discipline Score, Bias Radar and portfolio insights, explained in plain English.",
};

export default function InsightsPage() {
  return <InsightsView />;
}
