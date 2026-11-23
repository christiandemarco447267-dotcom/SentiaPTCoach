import type { Metadata } from "next";
import { ReportCardView } from "@/components/report-card-view";

export const metadata: Metadata = { title: "Weekly report card" };

export default function Page() {
  return <ReportCardView />;
}
