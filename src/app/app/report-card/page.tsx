import type { Metadata } from "next";
import { ReportCardView } from "@/components/report-card-view";

export const metadata: Metadata = {
  title: "Weekly report card",
  description: "A weekly report card on your trading process: plans, reviews, biases and returns vs the S&P 500.",
};

export default function Page() {
  return <ReportCardView />;
}
